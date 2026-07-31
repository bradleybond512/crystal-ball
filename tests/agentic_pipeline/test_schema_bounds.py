import json
import unittest
from pathlib import Path


class SchemaBoundTests(unittest.TestCase):
    def test_model_output_strings_and_arrays_are_bounded(self):
        schema_root = (
            Path(__file__).resolve().parents[2]
            / "tools/agentic_pipeline/schemas"
        )
        missing = []
        for path in schema_root.glob("*.schema.json"):
            schema = json.loads(path.read_text())
            self._find_unbounded(schema, path.name, "$", missing)

        self.assertEqual(missing, [])

    def _find_unbounded(self, value, filename, location, missing):
        if isinstance(value, dict):
            if value.get("type") == "string" and "maxLength" not in value:
                missing.append(f"{filename}:{location}:maxLength")
            if value.get("type") == "array" and "maxItems" not in value:
                missing.append(f"{filename}:{location}:maxItems")
            for key, item in value.items():
                self._find_unbounded(
                    item,
                    filename,
                    f"{location}.{key}",
                    missing,
                )
        elif isinstance(value, list):
            for index, item in enumerate(value):
                self._find_unbounded(
                    item,
                    filename,
                    f"{location}[{index}]",
                    missing,
                )


if __name__ == "__main__":
    unittest.main()
