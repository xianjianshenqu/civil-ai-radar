from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "validate_quote.py"
SPEC = importlib.util.spec_from_file_location("validate_quote", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ValidateQuoteTests(unittest.TestCase):
    def test_public_example_is_valid(self) -> None:
        data = json.loads((ROOT / "examples" / "synthetic-quote.json").read_text(encoding="utf-8"))
        result = MODULE.validate_quote(data)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["errors"], [])

    def test_invalid_line_and_total_are_reported(self) -> None:
        result = MODULE.validate_quote(
            {
                "prices_include_tax": False,
                "tax_rate": "0.06",
                "options": [
                    {
                        "name": "Base",
                        "items": [
                            {
                                "name": "Service",
                                "quantity": "2",
                                "unit_price": "10000",
                                "declared_line_total": "19000"
                            }
                        ],
                        "declared_subtotal": "19000",
                        "declared_tax": "1200",
                        "declared_total": "20200"
                    }
                ]
            }
        )
        self.assertEqual(result["status"], "invalid")
        self.assertGreaterEqual(len(result["errors"]), 3)

    def test_rejects_non_boolean_tax_flag(self) -> None:
        with self.assertRaises(MODULE.QuoteInputError):
            MODULE.validate_quote(
                {
                    "prices_include_tax": "yes",
                    "tax_rate": "0.06",
                    "options": [{"name": "x", "items": []}]
                }
            )


if __name__ == "__main__":
    unittest.main()
