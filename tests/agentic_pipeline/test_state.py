import os
import tempfile
import unittest
from pathlib import Path

from tools.agentic_pipeline.models import BudgetLimits, PipelineStatus
from tools.agentic_pipeline.state import StateStore


class StateStoreTests(unittest.TestCase):
    def test_new_control_plane_sha_creates_a_new_pipeline(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = StateStore(Path(temp_dir) / "state.sqlite")
            first, first_created = store.create_or_get(
                "Build feature",
                "codex/test",
                BudgetLimits(max_total_tokens=1_000, max_invocations=5),
                baseline_sha="target",
                control_sha="control-one",
            )
            second, second_created = store.create_or_get(
                "Build feature",
                "codex/test",
                BudgetLimits(max_total_tokens=1_000, max_invocations=5),
                baseline_sha="target",
                control_sha="control-two",
            )
            store.close()

        self.assertTrue(first_created)
        self.assertTrue(second_created)
        self.assertNotEqual(first.pipeline_id, second.pipeline_id)

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "state.sqlite"
        self.store = StateStore(self.db_path)

    def tearDown(self):
        self.store.close()
        self.temp_dir.cleanup()

    def test_create_is_idempotent_for_same_request_and_branch(self):
        first, created_first = self.store.create_or_get(
            "Build the pipeline",
            "codex/engineering-os-v2",
            BudgetLimits(max_total_tokens=10_000, max_invocations=5),
        )
        second, created_second = self.store.create_or_get(
            "Build the pipeline",
            "codex/engineering-os-v2",
            BudgetLimits(max_total_tokens=10_000, max_invocations=5),
        )

        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(first.pipeline_id, second.pipeline_id)
        self.assertEqual(oct(os.stat(self.db_path).st_mode & 0o777), "0o600")
        for suffix in ("-wal", "-shm"):
            auxiliary = Path(f"{self.db_path}{suffix}")
            if auxiliary.exists():
                self.assertEqual(
                    oct(os.stat(auxiliary).st_mode & 0o777),
                    "0o600",
                )

    def test_save_uses_optimistic_versioning(self):
        state, _ = self.store.create_or_get(
            "Build the pipeline",
            "codex/engineering-os-v2",
            BudgetLimits(max_total_tokens=10_000, max_invocations=5),
        )
        stale = self.store.get(state.pipeline_id)
        state.status = PipelineStatus.RUNNING
        self.store.save(state)

        stale.status = PipelineStatus.BLOCKED
        with self.assertRaises(RuntimeError):
            self.store.save(stale)

    def test_approval_is_durable_and_idempotent(self):
        state, _ = self.store.create_or_get(
            "High assurance work",
            "codex/engineering-os-v2",
            BudgetLimits(max_total_tokens=10_000, max_invocations=5),
        )

        self.assertTrue(self.store.approve(state.pipeline_id, "design", "bradley"))
        self.assertFalse(self.store.approve(state.pipeline_id, "design", "bradley"))
        self.assertTrue(self.store.has_approval(state.pipeline_id, "design"))


if __name__ == "__main__":
    unittest.main()
