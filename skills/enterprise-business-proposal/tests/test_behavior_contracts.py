from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class BehaviorContractTests(unittest.TestCase):
    def test_contracts_are_well_formed_and_unique(self) -> None:
        path = ROOT / "tests" / "scenarios" / "behavior-contracts.json"
        contracts = json.loads(path.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(contracts), 6)
        identifiers = [contract["id"] for contract in contracts]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        for contract in contracts:
            self.assertIn(contract["expected_mode"], {"create", "review/audit", "review/revise"})
            self.assertTrue(contract["prompt"].strip())
            self.assertTrue(contract["required_invariants"])
            self.assertTrue(contract["forbidden_outcomes"])


if __name__ == "__main__":
    unittest.main()
