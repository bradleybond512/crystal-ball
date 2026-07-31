import tempfile
import subprocess
import unittest
from collections import deque
from pathlib import Path

from tools.agentic_pipeline.models import (
    AgentAssignment,
    BudgetLimits,
    InvocationResult,
    PipelineStatus,
    RouteDecision,
    TokenUsage,
    ValidationResult,
)
from tools.agentic_pipeline.orchestrator import Orchestrator
from tools.agentic_pipeline.state import StateStore


class FakeRouter:
    def __init__(
        self,
        high_assurance=False,
        model_review=True,
        mechanical=False,
    ):
        self.high_assurance = high_assurance
        self.model_review = model_review
        self.mechanical = mechanical

    def route(self, _request):
        return RouteDecision(
            tier=(
                "mechanical"
                if self.mechanical
                else "high_assurance" if self.high_assurance else "standard"
            ),
            planner=AgentAssignment("architect", "gpt-5.6-sol", "high"),
            builder=AgentAssignment(
                "provider_engineer", "gpt-5.6-terra", "medium"
            ),
            reviewer=AgentAssignment(
                "independent_reviewer", "gpt-5.6-sol", "high"
            ),
            targeted_checks=[["npm", "run", "test:providers"]],
            always_run=[["bash", "scripts/agentic-check-changed.sh"]],
            requires_design_approval=self.high_assurance,
            max_automatic_repairs=2,
            rationale=["provider_engineer"],
            requires_model_review=self.model_review,
        )


class FakeCodex:
    def __init__(self, payloads, on_invoke=None):
        self.payloads = deque(payloads)
        self.calls = []
        self.on_invoke = on_invoke

    def invoke(
        self,
        assignment,
        prompt,
        schema,
        read_only,
        token_limit=None,
    ):
        self.calls.append(
            (assignment.agent, prompt, schema.name, read_only, token_limit)
        )
        if self.on_invoke:
            self.on_invoke(assignment, read_only)
        payload = self.payloads.popleft()
        return InvocationResult(
            succeeded=True,
            exit_code=0,
            payload=payload,
            stdout="",
            stderr="",
            usage=TokenUsage(input_tokens=10, output_tokens=5, cost_usd=0.01),
        )


class FakeValidators:
    def __init__(self, batches):
        self.batches = deque(batches)
        self.calls = []

    def run_many(self, commands):
        self.calls.append(commands)
        return self.batches.popleft()


def passed(command):
    return ValidationResult(command=command, exit_code=0, stdout="", stderr="")


def failed(command):
    return ValidationResult(
        command=command,
        exit_code=1,
        stdout="",
        stderr="assertion failed",
        failure_class="test",
    )


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.store = StateStore(self.root / "state.sqlite")

    def tearDown(self):
        self.store.close()
        self.temp_dir.cleanup()

    def test_high_assurance_pipeline_resumes_after_durable_approval(self):
        codex = FakeCodex(
            [
                {"summary": "plan", "tasks": [{"id": "T1", "objective": "build"}]},
                {"summary": "implemented", "changed_files": ["provider.ts"]},
                {"blocking_findings": [], "summary": "clean"},
            ]
        )
        validators = FakeValidators(
            [
                [
                    passed(["npm", "run", "test:providers"]),
                    passed(["bash", "scripts/agentic-check-changed.sh"]),
                ]
            ]
        )
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(high_assurance=True), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(
                max_total_tokens=1_000, max_invocations=10, max_cost_usd=1.0
            ),
        )

        paused = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(paused.status, PipelineStatus.WAITING_APPROVAL)
        self.assertEqual([call[0] for call in codex.calls], ["architect"])

        self.store.approve(state.pipeline_id, "design", "bradley")
        completed = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(completed.status, PipelineStatus.COMPLETED)
        self.assertEqual(
            [call[0] for call in codex.calls],
            ["architect", "provider_engineer", "independent_reviewer"],
        )

    def test_mechanical_pipeline_completes_after_deterministic_validation(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        (self.root / ".git/info/exclude").write_text("state.sqlite*\n")
        codex = FakeCodex(
            [
                {"summary": "implemented", "changed_files": ["README.md"]},
            ]
        )
        gate = ["bash", "scripts/agentic-check-mechanical.sh"]
        validators = FakeValidators([[passed(gate)]])
        orchestrator = Orchestrator(
            self.root,
            self.store,
            FakeRouter(model_review=False, mechanical=True),
            codex,
            validators,
        )
        state, _ = self.store.create_or_get(
            "Fix typo in README",
            "codex/docs",
            BudgetLimits(max_total_tokens=1_000, max_invocations=5),
        )

        completed = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(completed.status, PipelineStatus.COMPLETED)
        self.assertEqual(
            [call[0] for call in codex.calls],
            ["provider_engineer"],
        )

    def test_blocks_before_model_invocation_when_workspace_contains_env_file(self):
        (self.root / ".env").write_text("OPENAI_API_KEY=secret")
        codex = FakeCodex(
            [
                {"summary": "plan", "tasks": [{"id": "T1", "objective": "build"}]},
                {"summary": "implemented", "changed_files": ["provider.ts"]},
                {"blocking_findings": [], "summary": "clean"},
            ]
        )
        validators = FakeValidators(
            [
                [
                    passed(["npm", "run", "test:providers"]),
                    passed(["bash", "scripts/agentic-check-changed.sh"]),
                ]
            ]
        )
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(max_total_tokens=1_000, max_invocations=10),
        )

        blocked = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(blocked.status, PipelineStatus.BLOCKED)
        self.assertEqual(blocked.last_failure.failure_class, "workspace_secret")
        self.assertEqual(codex.calls, [])

        (self.root / ".env").unlink()
        resumed = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(resumed.status, PipelineStatus.COMPLETED)

    def test_resume_blocks_when_target_commit_no_longer_matches_ledger(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=self.root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=self.root,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "--allow-empty", "-qm", "baseline"],
            cwd=self.root,
            check=True,
        )
        codex = FakeCodex([])
        validators = FakeValidators([])
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(max_total_tokens=1_000, max_invocations=10),
            baseline_sha="0000000000000000000000000000000000000000",
        )

        blocked = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(blocked.status, PipelineStatus.BLOCKED)
        self.assertEqual(blocked.last_failure.failure_class, "provenance")
        self.assertEqual(codex.calls, [])
        self.assertEqual(validators.calls, [])

    def test_validation_failure_returns_to_original_builder_then_reruns(self):
        target = ["npm", "run", "test:providers"]
        broad = ["bash", "scripts/agentic-check-changed.sh"]
        codex = FakeCodex(
            [
                {"summary": "plan", "tasks": [{"id": "T1", "objective": "build"}]},
                {"summary": "implemented", "changed_files": ["provider.ts"]},
                {"summary": "repaired", "changed_files": ["provider.ts"]},
                {"blocking_findings": [], "summary": "clean"},
            ]
        )
        validators = FakeValidators(
            [
                [failed(target)],
                [passed(target)],
                [passed(target), passed(broad)],
            ]
        )
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(
                max_total_tokens=1_000, max_invocations=10, max_cost_usd=1.0
            ),
        )

        completed = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(completed.status, PipelineStatus.COMPLETED)
        self.assertEqual(codex.calls[2][0], "provider_engineer")
        self.assertIn("assertion failed", codex.calls[2][1])
        self.assertEqual(validators.calls[1], [target])
        self.assertEqual(validators.calls[2], [target, broad])

    def test_third_validation_failure_stops_mutation_after_sol_diagnosis(self):
        target = ["npm", "run", "test:providers"]
        codex = FakeCodex(
            [
                {"summary": "plan", "tasks": [{"id": "T1", "objective": "build"}]},
                {"summary": "implemented", "changed_files": ["provider.ts"]},
                {"summary": "repair one", "changed_files": ["provider.ts"]},
                {"summary": "repair two", "changed_files": ["provider.ts"]},
                {"summary": "diagnosis", "blocking_findings": ["root cause"]},
            ]
        )
        validators = FakeValidators(
            [[failed(target)], [failed(target)], [failed(target)]]
        )
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(
                max_total_tokens=1_000, max_invocations=10, max_cost_usd=1.0
            ),
        )

        blocked = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(blocked.status, PipelineStatus.BLOCKED)
        self.assertEqual(
            [call[0] for call in codex.calls],
            [
                "architect",
                "provider_engineer",
                "provider_engineer",
                "provider_engineer",
                "architect",
            ],
        )
        self.assertTrue(codex.calls[-1][3])
        self.assertEqual(blocked.repair_attempts, 2)

    def test_blocking_review_returns_to_builder_then_revalidates(self):
        target = ["npm", "run", "test:providers"]
        broad = ["bash", "scripts/agentic-check-changed.sh"]
        codex = FakeCodex(
            [
                {"summary": "plan", "tasks": [{"id": "T1", "objective": "build"}]},
                {"summary": "implemented", "changed_files": ["provider.ts"]},
                {
                    "blocking_findings": [
                        {"severity": "high", "problem": "unsafe parser"}
                    ],
                    "summary": "blocked",
                },
                {"summary": "review repair", "changed_files": ["provider.ts"]},
                {"blocking_findings": [], "summary": "clean"},
            ]
        )
        validators = FakeValidators(
            [
                [passed(target), passed(broad)],
                [passed(target), passed(broad)],
            ]
        )
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(
                max_total_tokens=1_000, max_invocations=10, max_cost_usd=1.0
            ),
        )

        completed = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(completed.status, PipelineStatus.COMPLETED)
        self.assertEqual(codex.calls[3][0], "provider_engineer")
        self.assertIn("unsafe parser", codex.calls[3][1])
        self.assertEqual(validators.calls[1], [target, broad])

    def test_blocks_out_of_scope_builder_changes_before_validation(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        (self.root / ".git/info/exclude").write_text("state.sqlite*\n")

        def mutate(_assignment, read_only):
            if not read_only:
                (self.root / "outside.txt").write_text("not approved")

        codex = FakeCodex(
            [
                {
                    "summary": "plan",
                    "tasks": [
                        {
                            "id": "T1",
                            "objective": "build",
                            "allowed_files": ["src/providers/**"],
                        }
                    ],
                    "approval_gates": [],
                },
                {"summary": "implemented", "changed_files": ["outside.txt"]},
            ],
            on_invoke=mutate,
        )
        validators = FakeValidators([])
        orchestrator = Orchestrator(
            self.root, self.store, FakeRouter(), codex, validators
        )
        state, _ = self.store.create_or_get(
            "Add a provider",
            "codex/feature",
            BudgetLimits(max_total_tokens=1_000, max_invocations=10),
        )

        blocked = orchestrator.run_until_blocked(state.pipeline_id)

        self.assertEqual(blocked.status, PipelineStatus.BLOCKED)
        self.assertEqual(blocked.last_failure.failure_class, "scope_violation")
        self.assertEqual(blocked.last_failure.changed_files, ["outside.txt"])
        self.assertEqual(validators.calls, [])


if __name__ == "__main__":
    unittest.main()
