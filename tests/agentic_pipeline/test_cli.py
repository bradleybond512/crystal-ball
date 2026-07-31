import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tools.agentic_pipeline.cli import main


class CliTests(unittest.TestCase):
    def test_create_only_is_idempotent_and_machine_readable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.sqlite"
            arguments = [
                "--state",
                str(state_path),
                "start",
                "--request",
                "Build pipeline",
                "--branch",
                "codex/test",
                "--max-total-tokens",
                "1000",
                "--max-invocations",
                "5",
                "--create-only",
                "--json",
            ]
            first_output = io.StringIO()
            with redirect_stdout(first_output):
                first_exit = main(arguments)
            second_output = io.StringIO()
            with redirect_stdout(second_output):
                second_exit = main(arguments)

        first = json.loads(first_output.getvalue())
        second = json.loads(second_output.getvalue())
        self.assertEqual(first_exit, 0)
        self.assertEqual(second_exit, 0)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["pipeline_id"], second["pipeline_id"])


if __name__ == "__main__":
    unittest.main()
