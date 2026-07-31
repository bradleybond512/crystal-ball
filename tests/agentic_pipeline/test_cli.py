import io
import json
import tempfile
import subprocess
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tools.agentic_pipeline.cli import main
from tools.agentic_pipeline.models import (
    BudgetLimits,
    FailurePacket,
    PipelineStatus,
)
from tools.agentic_pipeline.state import StateStore


class CliTests(unittest.TestCase):
    def test_provenance_requires_both_exact_checkouts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "target"
            control = Path(temp_dir) / "control"
            for repository in (root, control):
                repository.mkdir()
                subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
                subprocess.run(
                    ["git", "config", "user.email", "test@example.com"],
                    cwd=repository,
                    check=True,
                )
                subprocess.run(
                    ["git", "config", "user.name", "Test"],
                    cwd=repository,
                    check=True,
                )
                subprocess.run(
                    ["git", "commit", "--allow-empty", "-qm", "baseline"],
                    cwd=repository,
                    check=True,
                )
            target_head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
            control_head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=control,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
            state_path = root / "state.sqlite"
            store = StateStore(state_path)
            state, _ = store.create_or_get(
                "Build pipeline",
                "codex/test",
                BudgetLimits(max_total_tokens=1_000, max_invocations=5),
                baseline_sha=target_head,
                control_sha=control_head,
            )
            store.close()
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = main(
                    [
                        "--root",
                        str(root),
                        "--control-root",
                        str(control),
                        "--state",
                        str(state_path),
                        "provenance",
                        state.pipeline_id,
                        "--json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "baseline_sha": target_head,
                "control_sha": control_head,
            },
        )

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

    def test_reconcile_requires_the_inspected_head_and_clears_inflight_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(
                ["git", "config", "user.email", "test@example.com"],
                cwd=root,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=root,
                check=True,
            )
            subprocess.run(
                ["git", "commit", "--allow-empty", "-qm", "baseline"],
                cwd=root,
                check=True,
            )
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
            state_path = root / "state.sqlite"
            store = StateStore(state_path)
            state, _ = store.create_or_get(
                "Build pipeline",
                "codex/test",
                BudgetLimits(max_total_tokens=1_000, max_invocations=5),
                baseline_sha=head,
                control_sha=head,
            )
            state.status = PipelineStatus.BLOCKED
            state.inflight_invocation = "build"
            state.last_failure = FailurePacket(
                builder="provider_engineer",
                failure_class="uncertain_side_effect",
                command=[],
                exit_code=1,
                summary="interrupted",
                relevant_output="inspect",
                changed_files=[],
                attempt=0,
            )
            store.save(state)
            store.close()

            exit_code = main(
                [
                    "--root",
                    str(root),
                    "--state",
                    str(state_path),
                    "reconcile",
                    state.pipeline_id,
                    "--expected-head",
                    head,
                    "--actor",
                    "bradley",
                    "--action",
                    "retry",
                ]
            )

            store = StateStore(state_path)
            reconciled = store.get(state.pipeline_id)
            events = store.events(state.pipeline_id)
            store.close()

        self.assertEqual(exit_code, 0)
        self.assertEqual(reconciled.status, PipelineStatus.CREATED)
        self.assertIsNone(reconciled.inflight_invocation)
        self.assertIsNone(reconciled.last_failure)
        self.assertEqual(events[-1]["kind"], "inflight_reconciled")
        self.assertEqual(events[-1]["payload"]["actor"], "bradley")

    def test_reconcile_rejects_a_different_head(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            state_path = root / "state.sqlite"
            store = StateStore(state_path)
            state, _ = store.create_or_get(
                "Build pipeline",
                "codex/test",
                BudgetLimits(max_total_tokens=1_000, max_invocations=5),
            )
            state.status = PipelineStatus.BLOCKED
            state.inflight_invocation = "build"
            state.last_failure = FailurePacket(
                builder="provider_engineer",
                failure_class="uncertain_side_effect",
                command=[],
                exit_code=1,
                summary="interrupted",
                relevant_output="inspect",
                changed_files=[],
                attempt=0,
            )
            store.save(state)
            store.close()

            with self.assertRaises(PermissionError):
                main(
                    [
                        "--root",
                        str(root),
                        "--state",
                        str(state_path),
                        "reconcile",
                        state.pipeline_id,
                        "--expected-head",
                        "inspected-head",
                        "--actor",
                        "bradley",
                        "--action",
                        "retry",
                    ]
                )


if __name__ == "__main__":
    unittest.main()
