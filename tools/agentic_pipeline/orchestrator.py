from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from .models import (
    AgentAssignment,
    BudgetExceeded,
    FailurePacket,
    InvocationResult,
    PipelineStage,
    PipelineState,
    PipelineStatus,
    ValidationResult,
)
from .policy import PlanPolicy
from .state import StateStore


class Orchestrator:
    def __init__(
        self,
        root: Path,
        store: StateStore,
        router: Any,
        codex: Any,
        validators: Any,
        control_root: Path | None = None,
    ) -> None:
        self.root = root
        self.store = store
        self.router = router
        self.codex = codex
        self.validators = validators
        self.schemas = (
            control_root or root
        ) / "tools/agentic_pipeline/schemas"

    def run_until_blocked(self, pipeline_id: str) -> PipelineState:
        state = self.store.get(pipeline_id)
        provenance_error = self._provenance_error(state)
        if provenance_error:
            state.status = PipelineStatus.BLOCKED
            state.last_failure = FailurePacket(
                builder="orchestrator",
                failure_class="provenance",
                command=[],
                exit_code=1,
                summary="Pipeline checkout provenance does not match its ledger.",
                relevant_output=provenance_error,
                changed_files=[],
                attempt=state.repair_attempts,
            )
            self.store.save(state, "provenance_blocked")
            return state
        secret_file = self._workspace_secret_file()
        if secret_file:
            state.status = PipelineStatus.BLOCKED
            state.last_failure = FailurePacket(
                builder="orchestrator",
                failure_class="workspace_secret",
                command=[],
                exit_code=1,
                summary="Workspace contains a credential-bearing file.",
                relevant_output=(
                    f"Remove {secret_file} from the automation worktree and "
                    "restart from a clean, isolated checkout."
                ),
                changed_files=[],
                attempt=0,
            )
            self.store.save(
                state,
                "workspace_secret_blocked",
                {"path": secret_file},
            )
            return state
        if (
            state.status == PipelineStatus.BLOCKED
            and state.last_failure
            and state.last_failure.failure_class == "workspace_secret"
        ):
            state.status = PipelineStatus.CREATED
            state.last_failure = None
            self.store.save(state, "workspace_secret_cleared")
        if state.status in {
            PipelineStatus.COMPLETED,
            PipelineStatus.BLOCKED,
            PipelineStatus.BUDGET_EXCEEDED,
            PipelineStatus.CANCELLED,
        }:
            return state
        if state.inflight_invocation:
            state.status = PipelineStatus.BLOCKED
            state.last_failure = FailurePacket(
                builder=state.route.builder.agent if state.route else "unknown",
                failure_class="uncertain_side_effect",
                command=[],
                exit_code=1,
                summary="A prior model invocation did not record completion.",
                relevant_output=(
                    "Resume is fail-closed to avoid repeating a possibly mutating "
                    "invocation. Inspect the worktree and explicitly restart."
                ),
                changed_files=self._changed_files(),
                attempt=state.repair_attempts,
            )
            self.store.save(state, "uncertain_invocation_blocked")
            return state
        try:
            return self._run(state)
        except BudgetExceeded as error:
            state.status = PipelineStatus.BUDGET_EXCEEDED
            state.last_failure = FailurePacket(
                builder=state.route.builder.agent if state.route else "unknown",
                failure_class="budget",
                command=[],
                exit_code=1,
                summary=str(error),
                relevant_output="",
                changed_files=self._changed_files(),
                attempt=state.repair_attempts,
            )
            self.store.save(state, "budget_exceeded", {"reason": str(error)})
            return state

    def _run(self, state: PipelineState) -> PipelineState:
        if state.route is None:
            state.route = self.router.route(state.request)
            state.status = PipelineStatus.RUNNING
            state.stage = PipelineStage.PLANNING
            self.store.save(
                state,
                "routed",
                {
                    "tier": state.route.tier,
                    "builder": state.route.builder.agent,
                },
            )
        if state.plan is None:
            if state.route.tier == "mechanical":
                state.plan = self._mechanical_plan(state.request)
                self.store.save(state, "deterministic_plan_completed")
            else:
                result = self._invoke(
                    state,
                    "plan",
                    state.route.planner,
                    self._planning_prompt(state),
                    "plan.schema.json",
                    read_only=True,
                )
                if not result.succeeded:
                    return self._block_invocation(
                        state, state.route.planner, result
                    )
                state.plan = result.payload
                self.store.save(state, "plan_completed")
        plan_policy = PlanPolicy(state.plan)
        approved = {
            gate
            for gate in plan_policy.approval_gates
            if self.store.has_approval(state.pipeline_id, gate)
        }
        pending_gates = plan_policy.pending_gates(approved)
        if pending_gates:
            state.status = PipelineStatus.WAITING_APPROVAL
            state.stage = PipelineStage.DESIGN_APPROVAL
            self.store.save(
                state,
                "approval_required",
                {"gate": pending_gates[0]},
            )
            return state
        if (
            state.route.requires_design_approval
            and not self.store.has_approval(state.pipeline_id, "design")
        ):
            state.status = PipelineStatus.WAITING_APPROVAL
            state.stage = PipelineStage.DESIGN_APPROVAL
            self.store.save(state, "approval_required", {"gate": "design"})
            return state
        state.status = PipelineStatus.RUNNING
        if state.implementation is None:
            state.stage = PipelineStage.IMPLEMENTING
            result = self._invoke(
                state,
                "build",
                state.route.builder,
                self._build_prompt(state),
                "build.schema.json",
                read_only=False,
            )
            if not result.succeeded:
                return self._block_invocation(state, state.route.builder, result)
            state.implementation = result.payload
            self.store.save(state, "implementation_completed")
        scope_block = self._scope_block(state)
        if scope_block:
            return scope_block
        state.stage = PipelineStage.VALIDATING
        commands = state.route.validation_commands
        results = self.validators.run_many(commands)
        state.validation_results = results
        self.store.save(state, "validation_completed", _result_summary(results))
        failed = next((result for result in results if not result.succeeded), None)
        if failed:
            if failed.failure_class in {
                "policy_tamper",
                "validator_mutation",
                "workspace_integrity",
            }:
                state.status = PipelineStatus.BLOCKED
                state.last_failure = self._failure_packet(state, failed)
                self.store.save(
                    state,
                    "validation_policy_blocked",
                    _result_summary([failed]),
                )
                return state
            repaired = self._repair_validation(state, failed, commands)
            if repaired is not None:
                return repaired
        post_validation_scope = self._scope_block(state)
        if post_validation_scope:
            return post_validation_scope
        if not state.route.requires_model_review:
            state.review = {
                "summary": "Deterministic mechanical checks passed.",
                "blocking_findings": [],
                "nonblocking_findings": [],
            }
            state.status = PipelineStatus.COMPLETED
            state.stage = PipelineStage.COMPLETE
            state.last_failure = None
            self.store.save(state, "model_review_skipped")
            return state
        return self._review(state, commands)

    def _repair_validation(
        self,
        state: PipelineState,
        failed: ValidationResult,
        commands: list[list[str]],
    ) -> PipelineState | None:
        while state.repair_attempts < state.route.max_automatic_repairs:
            packet = self._failure_packet(state, failed)
            state.last_failure = packet
            result = self._invoke(
                state,
                f"repair-{packet.attempt}",
                self._repair_assignment(state),
                self._repair_prompt(state, packet),
                "build.schema.json",
                read_only=False,
            )
            state.repair_attempts += 1
            if not result.succeeded:
                return self._block_invocation(
                    state, state.route.builder, result
                )
            state.implementation = result.payload
            self.store.save(
                state,
                "repair_completed",
                {"attempt": state.repair_attempts},
            )
            scope_block = self._scope_block(state)
            if scope_block:
                return scope_block
            failed_first = self.validators.run_many([failed.command])
            state.validation_results = failed_first
            self.store.save(
                state,
                "failed_command_rerun",
                _result_summary(failed_first),
            )
            failed = next(
                (result for result in failed_first if not result.succeeded),
                None,
            )
            if failed:
                continue
            broad = self.validators.run_many(commands)
            state.validation_results = broad
            self.store.save(
                state, "validation_rerun", _result_summary(broad)
            )
            failed = next(
                (result for result in broad if not result.succeeded), None
            )
            if not failed:
                state.last_failure = None
                return None
        self._diagnose(state, failed)
        return state

    def _review(
        self, state: PipelineState, commands: list[list[str]]
    ) -> PipelineState:
        while True:
            state.stage = PipelineStage.REVIEWING
            result = self._invoke(
                state,
                "review",
                state.route.reviewer,
                self._review_prompt(state),
                "review.schema.json",
                read_only=True,
            )
            if not result.succeeded:
                return self._block_invocation(
                    state, state.route.reviewer, result
                )
            state.review = result.payload
            findings = result.payload.get("blocking_findings", [])
            self.store.save(
                state,
                "review_completed",
                {"blocking_findings": len(findings)},
            )
            if not findings:
                state.status = PipelineStatus.COMPLETED
                state.stage = PipelineStage.COMPLETE
                state.last_failure = None
                self.store.save(state, "completed")
                return state
            failure = ValidationResult(
                command=["independent-review"],
                exit_code=1,
                stdout="",
                stderr=json.dumps(findings, sort_keys=True),
                failure_class="review",
            )
            if state.repair_attempts >= state.route.max_automatic_repairs:
                self._diagnose(state, failure)
                return state
            packet = self._failure_packet(state, failure)
            state.last_failure = packet
            repair = self._invoke(
                state,
                f"review-repair-{packet.attempt}",
                self._repair_assignment(state),
                self._repair_prompt(state, packet),
                "build.schema.json",
                read_only=False,
            )
            state.repair_attempts += 1
            if not repair.succeeded:
                return self._block_invocation(
                    state, state.route.builder, repair
                )
            state.implementation = repair.payload
            self.store.save(
                state,
                "review_repair_completed",
                {"attempt": state.repair_attempts},
            )
            scope_block = self._scope_block(state)
            if scope_block:
                return scope_block
            validation = self.validators.run_many(commands)
            state.validation_results = validation
            self.store.save(
                state,
                "review_repair_validation",
                _result_summary(validation),
            )
            validation_failure = next(
                (item for item in validation if not item.succeeded), None
            )
            if validation_failure:
                repaired = self._repair_validation(
                    state, validation_failure, commands
                )
                if repaired is not None:
                    return repaired

    def _diagnose(
        self, state: PipelineState, failed: ValidationResult
    ) -> None:
        state.stage = PipelineStage.DIAGNOSING
        packet = self._failure_packet(state, failed)
        state.last_failure = packet
        diagnosis_assignment = AgentAssignment(
            agent="architect",
            model="gpt-5.6-sol",
            effort="high",
        )
        result = self._invoke(
            state,
            "diagnosis",
            diagnosis_assignment,
            self._diagnosis_prompt(state, packet),
            "diagnosis.schema.json",
            read_only=True,
        )
        state.diagnosis = result.payload
        state.status = PipelineStatus.BLOCKED
        self.store.save(state, "automatic_repairs_exhausted")

    def _invoke(
        self,
        state: PipelineState,
        invocation_key: str,
        assignment: AgentAssignment,
        prompt: str,
        schema_name: str,
        read_only: bool,
    ) -> InvocationResult:
        state.budget.reserve_invocation()
        state.inflight_invocation = invocation_key
        self.store.save(
            state,
            "invocation_started",
            {
                "key": invocation_key,
                "agent": assignment.agent,
                "model": assignment.model,
                "read_only": read_only,
            },
        )
        result = self.codex.invoke(
            assignment,
            prompt,
            self.schemas / schema_name,
            read_only,
            token_limit=state.budget.invocation_token_limit,
        )
        state.inflight_invocation = None
        state.budget.record(result.usage)
        self.store.save(
            state,
            "invocation_finished",
            {
                "key": invocation_key,
                "agent": assignment.agent,
                "exit_code": result.exit_code,
                "tokens": result.usage.total_tokens,
                "cost_usd": result.usage.cost_usd,
            },
        )
        return result

    def _repair_assignment(self, state: PipelineState) -> AgentAssignment:
        assignment = state.route.builder
        if state.repair_attempts == 0:
            return assignment
        effort_order = ["low", "medium", "high", "xhigh"]
        try:
            index = effort_order.index(assignment.effort)
        except ValueError:
            return assignment
        return AgentAssignment(
            agent=assignment.agent,
            model=assignment.model,
            effort=effort_order[min(index + 1, len(effort_order) - 1)],
        )

    def _failure_packet(
        self, state: PipelineState, failed: ValidationResult
    ) -> FailurePacket:
        output = (failed.stderr or failed.stdout)[-8_000:]
        return FailurePacket(
            builder=state.route.builder.agent,
            failure_class=failed.failure_class or "validation",
            command=failed.command,
            exit_code=failed.exit_code,
            summary=f"{' '.join(failed.command)} failed",
            relevant_output=output,
            changed_files=self._changed_files(),
            attempt=state.repair_attempts + 1,
        )

    def _block_invocation(
        self,
        state: PipelineState,
        assignment: AgentAssignment,
        result: InvocationResult,
    ) -> PipelineState:
        state.status = PipelineStatus.BLOCKED
        state.last_failure = FailurePacket(
            builder=assignment.agent,
            failure_class="model_invocation",
            command=["codex", "exec"],
            exit_code=result.exit_code,
            summary=f"{assignment.agent} invocation failed",
            relevant_output=(result.stderr or result.stdout)[-8_000:],
            changed_files=self._changed_files(),
            attempt=state.repair_attempts,
        )
        self.store.save(state, "invocation_blocked")
        return state

    def _changed_files(self) -> list[str]:
        result = subprocess.run(
            ["git", "status", "--short"],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            return ["<workspace-integrity-unavailable>"]
        return [
            line[3:] for line in result.stdout.splitlines() if len(line) > 3
        ]

    def _workspace_secret_file(self) -> str | None:
        candidates = [
            ".env",
            ".env.local",
            ".env.production",
            ".npmrc",
            ".pypirc",
        ]
        return next(
            (path for path in candidates if (self.root / path).is_file()),
            None,
        )

    def _scope_block(self, state: PipelineState) -> PipelineState | None:
        changed_files = self._changed_files()
        policy = PlanPolicy(state.plan or {})
        scope_violation = policy.out_of_scope(changed_files)
        if not scope_violation:
            missing_gates = [
                gate
                for gate in policy.required_gates_for_paths(changed_files)
                if not self.store.has_approval(state.pipeline_id, gate)
            ]
            if not missing_gates:
                return None
            state.status = PipelineStatus.WAITING_APPROVAL
            state.stage = PipelineStage.DESIGN_APPROVAL
            self.store.save(
                state,
                "approval_required",
                {
                    "gate": missing_gates[0],
                    "reason": "actual_diff",
                },
            )
            return state
        state.status = PipelineStatus.BLOCKED
        state.last_failure = FailurePacket(
            builder=state.route.builder.agent,
            failure_class="scope_violation",
            command=[],
            exit_code=1,
            summary="Builder changed files outside the approved plan.",
            relevant_output="\n".join(scope_violation),
            changed_files=scope_violation,
            attempt=state.repair_attempts,
        )
        self.store.save(
            state,
            "scope_violation_blocked",
            {"changed_files": scope_violation},
        )
        return state

    def _provenance_error(self, state: PipelineState) -> str | None:
        checks = (
            (self.root, state.baseline_sha, "target"),
            (self.schemas.parents[2], state.control_sha, "control"),
        )
        for root, expected, label in checks:
            if not expected:
                continue
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
            actual = result.stdout.strip()
            if result.returncode != 0 or actual != expected:
                return (
                    f"{label} checkout expected {expected}, "
                    f"found {actual or 'unavailable'}"
                )
        return None

    def _planning_prompt(self, state: PipelineState) -> str:
        return f"""Act as the {state.route.planner.agent} in read-only mode.
Read AGENTS.md, .codex/MODEL_POLICY.md, and the relevant repository paths.
Create the smallest repository-grounded plan for this request:

{state.request}

Return JSON matching the supplied schema. Include bounded tasks, allowed files,
acceptance criteria, validation commands, risks, rollback, and approval gates.
Do not edit files. Do not include credentials or environment values."""

    def _mechanical_plan(self, request: str) -> dict[str, Any]:
        normalized = request.lower()
        allowed_files = []
        if "readme" in normalized:
            allowed_files.append("README.md")
        if "changelog" in normalized:
            allowed_files.append("CHANGELOG.md")
        if any(word in normalized for word in ("doc", "documentation")):
            allowed_files.append("docs/**")
        if not allowed_files:
            allowed_files = ["README.md", "docs/**"]
        return {
            "summary": "Bounded mechanical documentation correction.",
            "tasks": [
                {
                    "id": "mechanical-edit",
                    "objective": request[:512],
                    "allowed_files": sorted(set(allowed_files)),
                    "acceptance_criteria": [
                        "Only the requested text or formatting changes."
                    ],
                    "validation_commands": [
                        "bash scripts/agentic-check-mechanical.sh"
                    ],
                }
            ],
            "risks": [],
            "rollback": "Revert the bounded documentation edit.",
            "approval_gates": [],
        }

    def _build_prompt(self, state: PipelineState) -> str:
        return f"""Act as the owning {state.route.builder.agent}.
Implement the approved plan below using test-driven development and only the
minimum necessary files. Read files before editing. Do not weaken tests or
validation. Do not push, merge, release, deploy, install, change secrets, or run
destructive commands.

REQUEST:
{state.request}

APPROVED PLAN:
{json.dumps(state.plan, sort_keys=True)}

Return JSON matching the supplied schema after making local changes."""

    def _repair_prompt(
        self, state: PipelineState, packet: FailurePacket
    ) -> str:
        return f"""Act as the original owning {packet.builder}.
Repair only the confirmed failure below. Preserve the approved design and
tests. Do not modify validation policy. Do not push, merge, release, deploy,
install, change secrets, or run destructive commands.

REQUEST:
{state.request}

FAILURE PACKET:
{json.dumps(packet.__dict__, sort_keys=True)}

Return JSON matching the supplied schema after making local changes."""

    def _review_prompt(self, state: PipelineState) -> str:
        return f"""Act as {state.route.reviewer.agent} in read-only mode.
Independently inspect the actual git diff, affected execution paths, and tests.
Prioritize correctness, security, regressions, failure handling, concurrency,
performance, and missing tests. Do not edit files.

REQUEST:
{state.request}

PLAN:
{json.dumps(state.plan, sort_keys=True)}

Return JSON matching the supplied schema. Only concrete, evidenced findings may
be blocking."""

    def _diagnosis_prompt(
        self, state: PipelineState, packet: FailurePacket
    ) -> str:
        return f"""Act as a read-only GPT-5.6 Sol diagnostician.
Two automatic builder repairs have failed. Inspect the diff and failure packet,
identify the likely root cause, and recommend bounded next actions. Do not edit.

REQUEST:
{state.request}

FAILURE PACKET:
{json.dumps(packet.__dict__, sort_keys=True)}

Return JSON matching the supplied schema."""


def _result_summary(results: list[ValidationResult]) -> dict[str, Any]:
    return {
        "commands": [
            {
                "command": result.command,
                "exit_code": result.exit_code,
                "failure_class": result.failure_class,
                "duration_seconds": result.duration_seconds,
            }
            for result in results
        ]
    }
