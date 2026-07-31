import unittest
from pathlib import Path


class WorkflowSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.workflow = (
            root / ".github/workflows/agentic-pipeline.yml"
        ).read_text()

    def test_uses_protected_control_plane_and_separate_target_worktree(self):
        self.assertIn("Checkout protected control plane", self.workflow)
        self.assertIn("path: control-plane", self.workflow)
        self.assertIn("Checkout mutable target worktree", self.workflow)
        self.assertIn("path: agent-worktree", self.workflow)
        self.assertIn("--control-root \"$CONTROL_ROOT\"", self.workflow)
        self.assertIn(
            'checkout --detach "$expected_control_sha"',
            self.workflow,
        )
        self.assertIn(".agentic-run/control-sha", self.workflow)

    def test_default_job_permissions_are_read_only(self):
        permissions = self.workflow.split("permissions:", 1)[1].split(
            "concurrency:", 1
        )[0]
        self.assertIn("contents: read", permissions)
        self.assertIn("pull-requests: read", permissions)
        self.assertNotIn("contents: write", permissions)

    def test_model_credential_is_scoped_to_one_pipeline_step(self):
        self.assertEqual(self.workflow.count("OPENAI_API_KEY:"), 1)
        model_step = self.workflow.split(
            "- name: Run or resume protected pipeline", 1
        )[1].split("- name: Package resumable state", 1)[0]
        self.assertIn("OPENAI_API_KEY:", model_step)

    def test_publish_is_a_dedicated_approval_gated_job(self):
        self.assertIn("\n  publish:\n", self.workflow)
        publish = self.workflow.split("\n  publish:\n", 1)[1]
        self.assertIn("contents: write", publish)
        self.assertIn("pull-requests: write", publish)
        self.assertIn("approve \"$PIPELINE_ID\"", publish)
        self.assertIn("--gate publish", publish)


if __name__ == "__main__":
    unittest.main()
