import unittest
from pathlib import Path


class WorkflowSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.root = root
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
        self.assertIn("max_tokens_per_invocation:", self.workflow)
        self.assertIn(
            '--max-tokens-per-invocation',
            model_step,
        )
        self.assertIn(
            '--validator-container-image "$VALIDATOR_IMAGE"',
            model_step,
        )

    def test_validator_image_is_resolved_before_model_credentials_are_available(self):
        prepare_index = self.workflow.index(
            "- name: Prepare isolated validator runtime"
        )
        model_index = self.workflow.index(
            "- name: Run or resume protected pipeline"
        )
        self.assertLess(prepare_index, model_index)
        prepare_step = self.workflow[prepare_index:model_index]
        self.assertIn('docker pull "$VALIDATOR_IMAGE_REF"', prepare_step)
        self.assertRegex(
            self.workflow,
            r"VALIDATOR_IMAGE_REF: node:22-bookworm@sha256:[0-9a-f]{64}",
        )
        self.assertIn("docker image inspect", prepare_step)
        self.assertIn("VALIDATOR_IMAGE=", prepare_step)
        self.assertNotIn("OPENAI_API_KEY", prepare_step)

    def test_publish_is_a_dedicated_approval_gated_job(self):
        self.assertIn("\n  publish:\n", self.workflow)
        publish = self.workflow.split("\n  publish:\n", 1)[1]
        self.assertIn("contents: write", publish)
        self.assertIn("pull-requests: write", publish)
        self.assertIn("approve \"$PIPELINE_ID\"", publish)
        self.assertIn("--gate publish", publish)
        self.assertIn("Verify reviewed checkout provenance", publish)
        self.assertIn('provenance "$PIPELINE_ID" --json', publish)
        self.assertIn("--force-with-lease=", publish)

    def test_interrupted_retry_requires_an_explicit_dispatch_choice(self):
        self.assertIn("reconcile_inflight:", self.workflow)
        self.assertIn("inputs.reconcile_inflight", self.workflow)
        self.assertIn('reconcile "$PIPELINE_ID"', self.workflow)
        self.assertIn('--expected-head "$TARGET_HEAD"', self.workflow)

    def test_internal_dispatch_does_not_require_external_cross_agent_marker(self):
        validation = (
            self.root / "scripts/agentic-validate.sh"
        ).read_text()
        self.assertIn('GITHUB_EVENT_NAME:-', validation)
        self.assertIn("pull_request", validation)

    def test_old_artifact_fails_with_an_explicit_migration_message(self):
        self.assertIn(
            "artifact predates control-plane provenance",
            self.workflow,
        )

    def test_resume_recovers_pipeline_id_from_artifact(self):
        dispatch = self.workflow.split("permissions:", 1)[0]
        self.assertNotIn("\n      pipeline_id:", dispatch)
        self.assertIn(
            'cp .agentic-resume/pipeline-id "$RUN_ROOT/pipeline-id"',
            self.workflow,
        )
        self.assertIn(
            'PIPELINE_ID="$(cat "$RUN_ROOT/pipeline-id")"',
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
