#!/usr/bin/env python3
"""Validate arithmetic consistency in a structured enterprise quote.

This script validates calculations only. It does not authorize prices, tax
rates, discounts, terms, gifts, or customer-facing commitments.
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any


MONEY = Decimal("0.01")


class QuoteInputError(ValueError):
    pass


def decimal_value(value: Any, field: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise QuoteInputError(f"{field} must be a decimal-compatible value")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise QuoteInputError(f"{field} is not a valid decimal: {value!r}") from exc
    if not result.is_finite():
        raise QuoteInputError(f"{field} must be finite")
    return result


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def close_enough(actual: Decimal, declared: Decimal, tolerance: Decimal) -> bool:
    return abs(actual - declared) <= tolerance


def validate_quote(data: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    computed_options: list[dict[str, Any]] = []

    include_tax = data.get("prices_include_tax")
    if not isinstance(include_tax, bool):
        raise QuoteInputError("prices_include_tax must be true or false")

    tax_rate = decimal_value(data.get("tax_rate"), "tax_rate")
    tolerance = decimal_value(data.get("tolerance", "0.01"), "tolerance")
    if tax_rate < 0:
        raise QuoteInputError("tax_rate cannot be negative")
    if tolerance < 0:
        raise QuoteInputError("tolerance cannot be negative")

    options = data.get("options")
    if not isinstance(options, list) or not options:
        raise QuoteInputError("options must be a non-empty list")

    for option_index, option in enumerate(options, 1):
        if not isinstance(option, dict):
            raise QuoteInputError(f"options[{option_index}] must be an object")
        option_name = str(option.get("name") or f"option-{option_index}")
        items = option.get("items")
        if not isinstance(items, list) or not items:
            errors.append(f"{option_name}: items must be a non-empty list")
            continue

        computed_items: list[dict[str, Any]] = []
        subtotal = Decimal("0")
        for item_index, item in enumerate(items, 1):
            if not isinstance(item, dict):
                errors.append(f"{option_name} item {item_index}: item must be an object")
                continue
            item_name = str(item.get("name") or f"item-{item_index}")
            prefix = f"{option_name} / {item_name}"
            try:
                quantity = decimal_value(item.get("quantity", "1"), f"{prefix}.quantity")
                unit_price = decimal_value(item.get("unit_price", "0"), f"{prefix}.unit_price")
                periods = decimal_value(item.get("periods", "1"), f"{prefix}.periods")
                discount = decimal_value(
                    item.get("discount_percent", "0"), f"{prefix}.discount_percent"
                )
            except QuoteInputError as exc:
                errors.append(str(exc))
                continue

            if quantity < 0 or unit_price < 0 or periods < 0:
                errors.append(f"{prefix}: quantity, unit_price and periods cannot be negative")
            if discount < 0 or discount > 100:
                errors.append(f"{prefix}: discount_percent must be between 0 and 100")

            gift = item.get("gift", False)
            if not isinstance(gift, bool):
                errors.append(f"{prefix}.gift must be true or false")
                gift = False

            base_total = quantity * unit_price * periods
            line_total = Decimal("0") if gift else base_total * (Decimal("1") - discount / 100)
            line_total = money(line_total)
            subtotal += line_total

            declared_line = item.get("declared_line_total")
            if declared_line is not None:
                try:
                    declared_line_value = money(
                        decimal_value(declared_line, f"{prefix}.declared_line_total")
                    )
                    if not close_enough(line_total, declared_line_value, tolerance):
                        errors.append(
                            f"{prefix}: declared line total {declared_line_value} "
                            f"does not match computed {line_total}"
                        )
                except QuoteInputError as exc:
                    errors.append(str(exc))
            else:
                warnings.append(f"{prefix}: declared_line_total is missing")

            if gift and unit_price == 0:
                warnings.append(
                    f"{prefix}: gift item has no reference unit price; do not claim a gift value"
                )

            computed_items.append(
                {
                    "name": item_name,
                    "base_total": str(money(base_total)),
                    "computed_line_total": str(line_total),
                    "gift": gift,
                }
            )

        subtotal = money(subtotal)
        option_tax_rate = decimal_value(option.get("tax_rate", tax_rate), f"{option_name}.tax_rate")
        if option_tax_rate < 0:
            errors.append(f"{option_name}: tax_rate cannot be negative")
            option_tax_rate = Decimal("0")

        if include_tax:
            total = subtotal
            tax = money(subtotal * option_tax_rate / (Decimal("1") + option_tax_rate))
        else:
            tax = money(subtotal * option_tax_rate)
            total = money(subtotal + tax)

        declarations = (
            ("declared_subtotal", subtotal),
            ("declared_tax", tax),
            ("declared_total", total),
        )
        for field, calculated in declarations:
            declared = option.get(field)
            if declared is None:
                warnings.append(f"{option_name}: {field} is missing")
                continue
            try:
                declared_value = money(decimal_value(declared, f"{option_name}.{field}"))
            except QuoteInputError as exc:
                errors.append(str(exc))
                continue
            if not close_enough(calculated, declared_value, tolerance):
                errors.append(
                    f"{option_name}: {field} {declared_value} does not match computed {calculated}"
                )

        computed_options.append(
            {
                "name": option_name,
                "items": computed_items,
                "computed_subtotal": str(subtotal),
                "computed_tax": str(tax),
                "computed_total": str(total),
            }
        )

    return {
        "status": "valid" if not errors else "invalid",
        "currency": str(data.get("currency", "CNY")),
        "prices_include_tax": include_tax,
        "errors": errors,
        "warnings": warnings,
        "computed_options": computed_options,
        "disclaimer": "Arithmetic validation only; commercial authorization is not validated.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("quote", type=Path, help="Path to quote JSON")
    parser.add_argument("--out", type=Path, help="Optional output JSON path")
    args = parser.parse_args()

    try:
        data = json.loads(args.quote.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict):
            raise QuoteInputError("top-level JSON value must be an object")
        result = validate_quote(data)
    except (OSError, json.JSONDecodeError, QuoteInputError) as exc:
        print(json.dumps({"status": "input_error", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if result["status"] == "valid" else 1


if __name__ == "__main__":
    sys.exit(main())
