from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .codex_client import CodexClient
from .github import GitHubClient
from .models import BudgetLimits, PipelineState, PipelineStatus
from .orchestrator import Orchestrator
from .router import AgentRouter, SAFE_EXACT_COMMANDS, SAFE_NPM_SCRIPTS
from .state import StateStore
from .validators import CommandPolicy, SubprocessValidator


EXIT_WAITING_APPROVAL = 10
EXIT_BLOCKED = 20


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="crystal-ball-agentic",
        description="Durable, model-routed Crystal Ball engineering pipeline",
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--state", type=Path, default=Path(".agentic-run/state.sqlite")
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start")
    start.add_argument("--request", required=True)
    start.add_argument("--branch", required=True)
    start.add_argument("--max-total-tokens", type=int, default=250_000)
    start.add_argument("--max-invocations", type=int, default=12)
    start.add_argument("--max-cost-usd", type=float)
    start.add_argument("--create-only", action="store_true")
    start.add_argument("--json", action="store_true")

    resume = subparsers.add_parser("resume")
    resume.add_argument("pipeline_id")
    resume.add_argument("--json", action="store_true")

    status = subparsers.add_parser("status")
    status.add_argument("pipeline_id")
    status.add_argument("--json", action="store_true")

    approve = subparsers.add_parser("approve")
    approve.add_argument("pipeline_id")
    approve.add_argument("--gate", required=True, choices=["design", "publish"])
    approve.add_argument("--actor", required=True)

    cancel = subparsers.add_parser("cancel")
    cancel.add_argument("pipeline_id")
    cancel.add_argument("--actor", required=True)

    summary = subparsers.add_parser("summary")
    summary.add_argument("pipeline_id")
    summary.add_argument("--output", type=Path)

    pr_update = subparsers.add_parser("pr-update")
    pr_update.add_argument("pipeline_id")
    pr_update.add_argument("--repository", required=True)
    pr_update.add_argument("--pr-number", type=int, required=True)
    return parser


def main(arguments: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(arguments)
    root = args.root.resolve()
    state_path = args.state
    if not state_path.is_absolute():
        state_path = root / state_path
    store = StateStore(state_path)
    try:
        if args.command == "start":
            _validate_positive(args.max_total_tokens, "max-total-tokens")
            _validate_positive(args.max_invocations, "max-invocations")
            state, created = store.create_or_get(
                args.request,
                args.branch,
                BudgetLimits(
                    max_total_tokens=args.max_total_tokens,
                    max_invocations=args.max_invocations,
                    max_cost_usd=args.max_cost_usd,
                ),
            )
            if args.create_only:
                _print_state(state, args.json, created=created)
                return 0
            state = _orchestrator(root, store, state).run_until_blocked(
                state.pipeline_id
            )
            _print_state(state, args.json, created=created)
            return _exit_for(state)
        if args.command == "resume":
            state = store.get(args.pipeline_id)
            state = _orchestrator(root, store, state).run_until_blocked(
                state.pipeline_id
            )
            _print_state(state, args.json)
            return _exit_for(state)
        if args.command == "status":
            _print_state(store.get(args.pipeline_id), args.json)
            return 0
        if args.command == "approve":
            created = store.approve(args.pipeline_id, args.gate, args.actor)
            print("approval recorded" if created else "approval already recorded")
            return 0
        if args.command == "cancel":
            state = store.get(args.pipeline_id)
            if state.status == PipelineStatus.COMPLETED:
                raise RuntimeError("completed pipelines cannot be cancelled")
            state.status = PipelineStatus.CANCELLED
            store.save(state, "cancelled", {"actor": args.actor})
            print(f"cancelled {state.pipeline_id}")
            return 0
        if args.command == "summary":
            summary = render_summary(store.get(args.pipeline_id))
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(summary)
            else:
                print(summary)
            return 0
        if args.command == "pr-update":
            state = store.get(args.pipeline_id)
            if state.status != PipelineStatus.COMPLETED:
                raise RuntimeError("only completed pipelines may update a PR")
            if not store.has_approval(args.pipeline_id, "publish"):
                raise PermissionError("publish approval is required")
            GitHubClient(args.repository).update_pr_body(
                args.pr_number, render_summary(state)
            )
            print(f"updated draft PR #{args.pr_number}")
            return 0
    finally:
        store.close()
    return 1


def _orchestrator(
    root: Path, store: StateStore, state: PipelineState
) -> Orchestrator:
    route = state.route or AgentRouter(root).route(state.request)
    allowed = [list(command) for command in SAFE_EXACT_COMMANDS]
    allowed.extend(
        [["npm", "run", script] for script in sorted(SAFE_NPM_SCRIPTS)]
    )
    validators = SubprocessValidator(root, CommandPolicy(allowed))
    router = _FixedRouter(route)
    return Orchestrator(root, store, router, CodexClient(root), validators)


class _FixedRouter:
    def __init__(self, route):
        self.route = route

    def route(self, _request):
        return self.route


def render_summary(state: PipelineState) -> str:
    checks = "\n".join(
        f"- `{' '.join(result.command)}` — exit {result.exit_code}"
        for result in state.validation_results
    )
    if not checks:
        checks = "- No validation results recorded."
    risks = []
    if state.last_failure:
        risks.append(state.last_failure.summary)
    if state.status != PipelineStatus.COMPLETED:
        risks.append(f"Pipeline status is `{state.status.value}`.")
    risk_text = "\n".join(f"- {risk}" for risk in risks) or "- None recorded."
    return f"""## Automated agentic pipeline

- Pipeline: `{state.pipeline_id}`
- Status: `{state.status.value}`
- Stage: `{state.stage.value}`
- Builder: `{state.route.builder.agent if state.route else "not routed"}`
- Model calls: {state.budget.invocation_count}
- Tokens: {state.budget.total_tokens}/{state.budget.limits.max_total_tokens}
- Recorded cost: ${state.budget.cost_usd:.4f}
- Automatic repairs: {state.repair_attempts}

### Validation

{checks}

### Remaining risks

{risk_text}

Merge, release, deploy, secret changes, and destructive actions remain outside
the automated pipeline and require explicit approval.
"""


def _print_state(
    state: PipelineState, as_json: bool, created: bool | None = None
) -> None:
    if as_json:
        payload = {
            "pipeline_id": state.pipeline_id,
            "status": state.status.value,
            "stage": state.stage.value,
        }
        if created is not None:
            payload["created"] = created
        print(json.dumps(payload, sort_keys=True))
    else:
        print(render_summary(state))


def _exit_for(state: PipelineState) -> int:
    if state.status == PipelineStatus.WAITING_APPROVAL:
        return EXIT_WAITING_APPROVAL
    if state.status in {
        PipelineStatus.BLOCKED,
        PipelineStatus.BUDGET_EXCEEDED,
        PipelineStatus.CANCELLED,
    }:
        return EXIT_BLOCKED
    return 0


def _validate_positive(value: int, name: str) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be positive")
