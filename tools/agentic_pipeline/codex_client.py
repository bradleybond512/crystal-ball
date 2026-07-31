from __future__ import annotations

import json
import os
import subprocess
import tomllib
from pathlib import Path
from typing import Callable

from .models import AgentAssignment, InvocationResult, TokenUsage
from .redaction import Redactor


class CodexClient:
    def __init__(
        self,
        root: Path,
        control_root: Path | None = None,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        timeout_seconds: int = 3_600,
        redactor: Redactor | None = None,
    ) -> None:
        self.root = root
        self.control_root = control_root or root
        self.runner = runner
        self.timeout_seconds = timeout_seconds
        self.redactor = redactor or Redactor()

    def invoke(
        self,
        assignment: AgentAssignment,
        prompt: str,
        schema: Path,
        read_only: bool,
        token_limit: int | None = None,
    ) -> InvocationResult:
        sandbox = "read-only" if read_only else "workspace-write"
        command = [
            "codex",
            "exec",
            "--strict-config",
            "--ephemeral",
            "--json",
            "--color",
            "never",
            "--model",
            assignment.model,
            "--sandbox",
            sandbox,
            "--output-schema",
            str(schema),
            "-c",
            f'model_reasoning_effort="{assignment.effort}"',
            "-c",
            'approval_policy="never"',
            "-c",
            'shell_environment_policy.inherit="none"',
            "-c",
            "sandbox_workspace_write.network_access=false",
            "--cd",
            str(self.root),
            "-",
        ]
        if token_limit is not None:
            if token_limit <= 0:
                raise ValueError("token_limit must be positive")
            insertion = command.index("--cd")
            reminder = max(1, min(1_000, token_limit // 5))
            command[insertion:insertion] = [
                "-c",
                "features.rollout_budget.enabled=true",
                "-c",
                f"features.rollout_budget.limit_tokens={token_limit}",
                "-c",
                (
                    "features.rollout_budget."
                    f"reminder_at_remaining_tokens=[{reminder}]"
                ),
            ]
        try:
            role_prompt = self._role_prompt(assignment, prompt)
        except (OSError, PermissionError, ValueError, tomllib.TOMLDecodeError) as error:
            return InvocationResult(
                succeeded=False,
                exit_code=126,
                payload=None,
                stdout="",
                stderr=self.redactor.redact(str(error)),
                usage=TokenUsage(),
            )
        try:
            result = self.runner(
                command,
                cwd=self.root,
                input=role_prompt,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
                env=self._minimal_environment(),
            )
        except subprocess.TimeoutExpired as error:
            return InvocationResult(
                succeeded=False,
                exit_code=124,
                payload=None,
                stdout=self.redactor.redact(_as_text(error.stdout)),
                stderr=self.redactor.redact(_as_text(error.stderr)),
                usage=TokenUsage(),
            )
        payload, usage = self._parse_events(result.stdout)
        return InvocationResult(
            succeeded=result.returncode == 0 and payload is not None,
            exit_code=result.returncode,
            payload=payload,
            stdout=self.redactor.redact(result.stdout),
            stderr=self.redactor.redact(result.stderr),
            usage=usage,
        )

    def _parse_events(
        self, output: str
    ) -> tuple[dict[str, object] | None, TokenUsage]:
        payload = None
        usage = TokenUsage()
        for line in output.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            event_usage = event.get("usage")
            if isinstance(event_usage, dict):
                usage = TokenUsage(
                    input_tokens=int(event_usage.get("input_tokens", 0)),
                    output_tokens=int(event_usage.get("output_tokens", 0)),
                    cached_input_tokens=int(
                        event_usage.get("cached_input_tokens", 0)
                    ),
                    cost_usd=(
                        float(event_usage["cost_usd"])
                        if event_usage.get("cost_usd") is not None
                        else None
                    ),
                )
            item = event.get("item")
            if (
                isinstance(item, dict)
                and item.get("type") == "agent_message"
                and isinstance(item.get("text"), str)
            ):
                try:
                    parsed = json.loads(item["text"])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    payload = self.redactor.redact_value(parsed)
        return payload, usage

    def _minimal_environment(self) -> dict[str, str]:
        allowed = ("PATH", "HOME", "CODEX_HOME", "OPENAI_API_KEY")
        return {key: os.environ[key] for key in allowed if key in os.environ}

    def _role_prompt(
        self, assignment: AgentAssignment, task_prompt: str
    ) -> str:
        path = (
            self.control_root
            / ".codex/agents"
            / f"{assignment.agent.replace('_', '-')}.toml"
        )
        if not path.is_file():
            return task_prompt
        agent = tomllib.loads(path.read_text())
        if agent.get("name") != assignment.agent:
            raise ValueError(
                f"agent definition name does not match {assignment.agent}"
            )
        instructions = agent.get("developer_instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            raise ValueError(
                f"agent {assignment.agent} has no developer instructions"
            )
        return f"""ROLE CONTRACT:
{instructions.strip()}

TASK:
{task_prompt}"""


def _as_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value
