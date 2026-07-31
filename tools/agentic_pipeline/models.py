from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any
from uuid import uuid4


class BudgetExceeded(RuntimeError):
    pass


class PipelineStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    BUDGET_EXCEEDED = "budget_exceeded"
    CANCELLED = "cancelled"


class PipelineStage(StrEnum):
    ROUTING = "routing"
    PLANNING = "planning"
    DESIGN_APPROVAL = "design_approval"
    IMPLEMENTING = "implementing"
    VALIDATING = "validating"
    REVIEWING = "reviewing"
    DIAGNOSING = "diagnosing"
    COMPLETE = "complete"


@dataclass
class BudgetLimits:
    max_total_tokens: int
    max_invocations: int
    max_cost_usd: float | None = None
    max_tokens_per_invocation: int | None = None


@dataclass
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    cost_usd: float | None = None

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class BudgetLedger:
    limits: BudgetLimits
    invocation_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    cost_usd: float = 0.0
    cost_is_complete: bool = True

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def remaining_tokens(self) -> int:
        return max(0, self.limits.max_total_tokens - self.total_tokens)

    @property
    def invocation_token_limit(self) -> int:
        if self.limits.max_tokens_per_invocation is None:
            return self.remaining_tokens
        return min(
            self.remaining_tokens,
            self.limits.max_tokens_per_invocation,
        )

    def reserve_invocation(self) -> None:
        if self.remaining_tokens == 0:
            raise BudgetExceeded("token budget exhausted")
        if self.invocation_count + 1 > self.limits.max_invocations:
            raise BudgetExceeded("invocation budget exceeded")
        self.invocation_count += 1

    def record(self, usage: TokenUsage) -> None:
        self.input_tokens += usage.input_tokens
        self.output_tokens += usage.output_tokens
        self.cached_input_tokens += usage.cached_input_tokens
        if self.total_tokens > self.limits.max_total_tokens:
            raise BudgetExceeded("token budget exceeded")
        if self.limits.max_cost_usd is not None and usage.cost_usd is None:
            self.cost_is_complete = False
            raise BudgetExceeded(
                "cost budget cannot be enforced because the invocation reported no cost"
            )
        self.cost_usd += usage.cost_usd or 0.0
        if (
            self.limits.max_cost_usd is not None
            and self.cost_usd > self.limits.max_cost_usd
        ):
            raise BudgetExceeded("cost budget exceeded")


@dataclass
class AgentAssignment:
    agent: str
    model: str
    effort: str


@dataclass
class RouteDecision:
    tier: str
    planner: AgentAssignment
    builder: AgentAssignment
    reviewer: AgentAssignment
    targeted_checks: list[list[str]]
    always_run: list[list[str]]
    requires_design_approval: bool
    max_automatic_repairs: int
    rationale: list[str]
    requires_model_review: bool = True

    @property
    def validation_commands(self) -> list[list[str]]:
        commands: list[list[str]] = []
        for command in [*self.targeted_checks, *self.always_run]:
            if command not in commands:
                commands.append(command)
        return commands


@dataclass
class ValidationResult:
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str
    failure_class: str | None = None
    duration_seconds: float = 0.0

    @property
    def succeeded(self) -> bool:
        return self.exit_code == 0


@dataclass
class FailurePacket:
    builder: str
    failure_class: str
    command: list[str]
    exit_code: int
    summary: str
    relevant_output: str
    changed_files: list[str]
    attempt: int
    constraints: list[str] = field(
        default_factory=lambda: [
            "Do not weaken or delete tests.",
            "Do not modify validation or CI policy.",
            "Remain within the approved task scope.",
            "Do not push, merge, release, deploy, change secrets, or run destructive commands.",
        ]
    )


@dataclass
class InvocationResult:
    succeeded: bool
    exit_code: int
    payload: dict[str, Any] | None
    stdout: str
    stderr: str
    usage: TokenUsage


@dataclass
class PipelineState:
    pipeline_id: str
    request: str
    request_hash: str
    branch: str
    baseline_sha: str
    control_sha: str
    status: PipelineStatus
    stage: PipelineStage
    budget: BudgetLedger
    version: int = 0
    route: RouteDecision | None = None
    plan: dict[str, Any] | None = None
    implementation: dict[str, Any] | None = None
    validation_results: list[ValidationResult] = field(default_factory=list)
    review: dict[str, Any] | None = None
    last_failure: FailurePacket | None = None
    repair_attempts: int = 0
    inflight_invocation: str | None = None
    diagnosis: dict[str, Any] | None = None

    @classmethod
    def new(
        cls,
        request: str,
        request_hash: str,
        budget: BudgetLimits,
        branch: str = "",
        baseline_sha: str = "",
        control_sha: str = "",
    ) -> PipelineState:
        return cls(
            pipeline_id=str(uuid4()),
            request=request,
            request_hash=request_hash,
            branch=branch,
            baseline_sha=baseline_sha,
            control_sha=control_sha,
            status=PipelineStatus.CREATED,
            stage=PipelineStage.ROUTING,
            budget=BudgetLedger(limits=budget),
        )

    def to_dict(self) -> dict[str, Any]:
        return _encode(asdict(self))

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> PipelineState:
        route_value = value.get("route")
        route = None
        if route_value:
            route = RouteDecision(
                tier=route_value["tier"],
                planner=AgentAssignment(**route_value["planner"]),
                builder=AgentAssignment(**route_value["builder"]),
                reviewer=AgentAssignment(**route_value["reviewer"]),
                targeted_checks=route_value["targeted_checks"],
                always_run=route_value["always_run"],
                requires_design_approval=route_value[
                    "requires_design_approval"
                ],
                max_automatic_repairs=route_value["max_automatic_repairs"],
                rationale=route_value["rationale"],
                requires_model_review=route_value.get(
                    "requires_model_review",
                    route_value["tier"] != "mechanical",
                ),
            )
        budget_value = value["budget"]
        budget = BudgetLedger(
            limits=BudgetLimits(**budget_value["limits"]),
            invocation_count=budget_value["invocation_count"],
            input_tokens=budget_value["input_tokens"],
            output_tokens=budget_value["output_tokens"],
            cached_input_tokens=budget_value["cached_input_tokens"],
            cost_usd=budget_value["cost_usd"],
            cost_is_complete=budget_value["cost_is_complete"],
        )
        return cls(
            pipeline_id=value["pipeline_id"],
            request=value["request"],
            request_hash=value["request_hash"],
            branch=value.get("branch", ""),
            baseline_sha=value.get("baseline_sha", ""),
            control_sha=value.get("control_sha", ""),
            status=PipelineStatus(value["status"]),
            stage=PipelineStage(value["stage"]),
            budget=budget,
            version=value.get("version", 0),
            route=route,
            plan=value.get("plan"),
            implementation=value.get("implementation"),
            validation_results=[
                ValidationResult(**result)
                for result in value.get("validation_results", [])
            ],
            review=value.get("review"),
            last_failure=(
                FailurePacket(**value["last_failure"])
                if value.get("last_failure")
                else None
            ),
            repair_attempts=value.get("repair_attempts", 0),
            inflight_invocation=value.get("inflight_invocation"),
            diagnosis=value.get("diagnosis"),
        )


def _encode(value: Any) -> Any:
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, dict):
        return {key: _encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    return value
