import json
import tempfile
import unittest
from pathlib import Path

from tools.agentic_pipeline.codex_client import CodexClient
from tools.agentic_pipeline.models import AgentAssignment


class CodexClientTests(unittest.TestCase):
    def test_builds_sandboxed_structured_codex_command_and_collects_usage(self):
        captured = {}

        def runner(command, **kwargs):
            captured["command"] = command
            captured["input"] = kwargs["input"]
            output = "\n".join(
                [
                    json.dumps(
                        {
                            "type": "turn.completed",
                            "usage": {"input_tokens": 20, "output_tokens": 5},
                        }
                    ),
                    json.dumps(
                        {
                            "type": "item.completed",
                            "item": {"type": "agent_message", "text": '{"ok": true}'},
                        }
                    ),
                ]
            )
            return type(
                "Result",
                (),
                {"returncode": 0, "stdout": output, "stderr": ""},
            )()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            schema = root / "schema.json"
            schema.write_text('{"type":"object"}')
            agents = root / ".codex/agents"
            agents.mkdir(parents=True)
            (agents / "architect.toml").write_text(
                'name = "architect"\n'
                'developer_instructions = """Use repository evidence."""\n'
            )
            result = CodexClient(root, runner=runner).invoke(
                AgentAssignment(
                    agent="architect", model="gpt-5.6-sol", effort="high"
                ),
                "Return a plan",
                schema,
                read_only=True,
            )

        command = captured["command"]
        self.assertEqual(command[0:2], ["codex", "exec"])
        self.assertIn("--ephemeral", command)
        self.assertIn("--output-schema", command)
        self.assertEqual(command[command.index("--sandbox") + 1], "read-only")
        self.assertIn('approval_policy="never"', command)
        self.assertNotIn("Return a plan", command)
        self.assertIn("Use repository evidence.", captured["input"])
        self.assertIn("Return a plan", captured["input"])
        self.assertEqual(result.payload, {"ok": True})
        self.assertEqual(result.usage.total_tokens, 25)

    def test_redacts_failed_codex_output(self):
        def runner(*_args, **_kwargs):
            return type(
                "Result",
                (),
                {
                    "returncode": 1,
                    "stdout": "",
                    "stderr": "OPENAI_API_KEY=do-not-log",
                },
            )()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            schema = root / "schema.json"
            schema.write_text('{"type":"object"}')
            result = CodexClient(root, runner=runner).invoke(
                AgentAssignment(
                    agent="architect", model="gpt-5.6-sol", effort="high"
                ),
                "Return a plan",
                schema,
                read_only=True,
            )

        self.assertFalse(result.succeeded)
        self.assertNotIn("do-not-log", result.stderr)


if __name__ == "__main__":
    unittest.main()
