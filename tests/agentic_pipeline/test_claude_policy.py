import json
import subprocess
import unittest
from pathlib import Path


class ClaudePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[2]

    def test_claude_imports_canonical_agent_policy(self):
        claude = (self.root / "CLAUDE.md").read_text()

        self.assertIn("@AGENTS.md", claude)
        self.assertIn("$crystal-ball-automated-pipeline", claude)
        self.assertIn(".codex/MODEL_POLICY.md", claude)

    def test_project_settings_enable_shared_cross_platform_policy_hook(self):
        settings = json.loads(
            (self.root / ".claude/settings.json").read_text()
        )
        hooks = settings["hooks"]

        self.assertIn("SessionStart", hooks)
        self.assertIn("PreToolUse", hooks)
        commands = json.dumps(hooks)
        self.assertIn(".claude/hooks/agentic-policy.mjs", commands)
        self.assertNotIn(".sh", commands)

    def test_claude_skill_delegates_to_the_canonical_runtime(self):
        skill = (
            self.root
            / ".claude/skills/crystal-ball-automated-pipeline/SKILL.md"
        ).read_text()

        self.assertIn("tools.agentic_pipeline", skill)
        self.assertIn(
            ".agents/skills/crystal-ball-automated-pipeline/SKILL.md",
            skill,
        )
        self.assertIn("Do not implement nontrivial work outside", skill)

    def test_hook_blocks_publish_and_merge_without_explicit_approval(self):
        hook = self.root / ".claude/hooks/agentic-policy.mjs"
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "git push origin HEAD"},
            }
        )

        result = subprocess.run(
            ["node", str(hook)],
            input=payload,
            text=True,
            capture_output=True,
            cwd=self.root,
            check=False,
        )

        self.assertEqual(result.returncode, 0)
        response = json.loads(result.stdout)
        decision = response["hookSpecificOutput"]
        self.assertEqual(decision["permissionDecision"], "deny")
        self.assertIn("explicit approval", decision["permissionDecisionReason"])


if __name__ == "__main__":
    unittest.main()
