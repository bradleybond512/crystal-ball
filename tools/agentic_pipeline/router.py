from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path
from typing import Callable

from .models import AgentAssignment, RouteDecision


PLANNING_AGENTS = {"architect", "mission_architect", "repository_analyst"}
NON_BUILDERS = {
    *PLANNING_AGENTS,
    "independent_reviewer",
    "accessibility_reviewer",
    "test_engineer",
    "product_designer",
    "architecture_memory",
    "benchmark_engineer",
    "release_engineer",
}
SAFE_NPM_SCRIPTS = {
    "bundle:check",
    "cross-agent:check",
    "docs:check",
    "lint:ci",
    "lint:colors",
    "lint:conflicts",
    "lint:json",
    "lint:md",
    "lint:shell",
    "lint:strict",
    "lint:yaml",
    "lockfile:check",
    "secrets:scan",
    "test:cognition",
    "test:correlation",
    "test:intelligence",
    "test:providers",
    "test:renderer",
    "test:sec-hardening",
    "typecheck:all",
    "version:check",
}
SAFE_EXACT_COMMANDS = {
    ("bash", "scripts/agentic-check-changed.sh"),
    ("bash", "scripts/agentic-validate.sh"),
    ("node", "scripts/check-agent-model-policy.mjs"),
}


class AgentRouter:
    def __init__(
        self,
        root: Path,
        control_root: Path | None = None,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        self.root = root
        self.control_root = control_root or root
        self.runner = runner
        self.policy = json.loads(
            (self.control_root / ".codex/model-policy.json").read_text()
        )

    def route(self, request: str) -> RouteDecision:
        router = self.control_root / "scripts/agent-router.mjs"
        router_command = (
            "scripts/agent-router.mjs"
            if self.control_root == self.root
            else str(router)
        )
        result = self.runner(
            ["node", router_command, "--request", request],
            cwd=self.root,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"agent router failed with exit {result.returncode}: "
                f"{result.stderr[-1_000:]}"
            )
        raw = json.loads(result.stdout)
        agents = raw.get("agents")
        if not isinstance(agents, list) or not all(
            isinstance(agent, str) for agent in agents
        ):
            raise ValueError("router output must contain a string agent list")
        unknown = set(agents) - set(self.policy.get("agents", {}))
        if unknown:
            raise ValueError(f"router selected unknown agents: {sorted(unknown)}")
        planner_name = "architect" if "architect" in self.policy["agents"] else agents[0]
        reviewer_name = (
            "independent_reviewer"
            if "independent_reviewer" in self.policy["agents"]
            else agents[-1]
        )
        builders = [agent for agent in agents if agent not in NON_BUILDERS]
        if not builders:
            builders = [
                agent
                for agent in ("intelligence_engineer", "repository_analyst")
                if agent in self.policy["agents"]
            ]
        if not builders:
            raise ValueError("router selected no implementation-capable agent")
        checks = [
            self._parse_safe_command(command)
            for command in raw.get("targeted_checks", [])
        ]
        router_always = [
            self._parse_safe_command(command)
            for command in raw.get("always_run", [])
        ]
        del router_always
        full_gate = ["bash", "scripts/agentic-validate.sh"]
        always = [full_gate]
        return RouteDecision(
            tier=str(raw.get("tier", "focused")),
            planner=self._assignment(planner_name),
            builder=self._assignment(builders[0]),
            reviewer=self._assignment(reviewer_name),
            targeted_checks=checks,
            always_run=always,
            requires_design_approval=bool(
                raw.get("human_design_approval", False)
            ),
            max_automatic_repairs=int(
                self.policy.get("defaults", {}).get(
                    "maxAutomaticRepairs", 2
                )
            ),
            rationale=[
                str(item) for item in raw.get("rationale", [])
            ],
        )

    def _assignment(self, agent: str) -> AgentAssignment:
        assignment = self.policy["agents"][agent]
        return AgentAssignment(
            agent=agent,
            model=assignment["model"],
            effort=assignment["effort"],
        )

    def _parse_safe_command(self, value: str) -> list[str]:
        if not isinstance(value, str):
            raise ValueError("validation commands must be strings")
        command = shlex.split(value)
        command_tuple = tuple(command)
        safe_npm = (
            len(command) == 3
            and command[:2] == ["npm", "run"]
            and command[2] in SAFE_NPM_SCRIPTS
        )
        if not safe_npm and command_tuple not in SAFE_EXACT_COMMANDS:
            raise ValueError(f"router emitted unsafe command: {value}")
        return command
