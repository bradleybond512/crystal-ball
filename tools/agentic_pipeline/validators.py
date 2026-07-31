from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from .models import ValidationResult
from .redaction import Redactor


class CommandPolicy:
    def __init__(self, allowed_commands: list[list[str]]) -> None:
        self.allowed = {tuple(command) for command in allowed_commands}

    def require_allowed(self, command: list[str]) -> None:
        if tuple(command) not in self.allowed:
            raise PermissionError(f"command is not allowlisted: {command!r}")


class SubprocessValidator:
    def __init__(
        self,
        root: Path,
        policy: CommandPolicy,
        timeout_seconds: float = 1_800,
        max_output_chars: int = 20_000,
        redactor: Redactor | None = None,
    ) -> None:
        self.root = root
        self.policy = policy
        self.timeout_seconds = timeout_seconds
        self.max_output_chars = max_output_chars
        self.redactor = redactor or Redactor()

    def run(self, command: list[str]) -> ValidationResult:
        self.policy.require_allowed(command)
        started = time.monotonic()
        tamper_reason = self._tamper_reason(command)
        if tamper_reason:
            return ValidationResult(
                command=command,
                exit_code=126,
                stdout="",
                stderr=tamper_reason,
                failure_class="policy_tamper",
                duration_seconds=time.monotonic() - started,
            )
        try:
            result = subprocess.run(
                command,
                cwd=self.root,
                env=self._validation_environment(),
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
            return ValidationResult(
                command=command,
                exit_code=result.returncode,
                stdout=self._bounded(result.stdout),
                stderr=self._bounded(result.stderr),
                failure_class=None if result.returncode == 0 else "validation",
                duration_seconds=time.monotonic() - started,
            )
        except subprocess.TimeoutExpired as error:
            return ValidationResult(
                command=command,
                exit_code=124,
                stdout=self._bounded(_as_text(error.stdout)),
                stderr=self._bounded(_as_text(error.stderr)),
                failure_class="timeout",
                duration_seconds=time.monotonic() - started,
            )

    def run_many(self, commands: list[list[str]]) -> list[ValidationResult]:
        results: list[ValidationResult] = []
        for command in commands:
            result = self.run(command)
            results.append(result)
            if not result.succeeded:
                break
        return results

    def _bounded(self, value: str) -> str:
        return self.redactor.redact(value[-self.max_output_chars :])

    def _validation_environment(self) -> dict[str, str]:
        blocked_names = {
            "ANTHROPIC_API_KEY",
            "CODEX_API_KEY",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "OPENAI_API_KEY",
        }
        blocked_suffixes = (
            "_API_KEY",
            "_PASSWORD",
            "_PRIVATE_KEY",
            "_SECRET",
            "_TOKEN",
        )
        environment = {
            key: value
            for key, value in os.environ.items()
            if key not in blocked_names
            and not key.upper().endswith(blocked_suffixes)
        }
        environment.update(
            {
                "CI": "true",
                "npm_config_ignore_scripts": "true",
                "NPM_CONFIG_IGNORE_SCRIPTS": "true",
            }
        )
        return environment

    def _tamper_reason(self, command: list[str]) -> str | None:
        if len(command) == 3 and command[:2] == ["npm", "run"]:
            try:
                baseline = json.loads(
                    subprocess.run(
                        ["git", "show", "HEAD:package.json"],
                        cwd=self.root,
                        text=True,
                        capture_output=True,
                        timeout=10,
                        check=True,
                    ).stdout
                )
                current = json.loads((self.root / "package.json").read_text())
            except (
                OSError,
                json.JSONDecodeError,
                subprocess.CalledProcessError,
                subprocess.TimeoutExpired,
            ):
                return "cannot verify package.json script against HEAD"
            script = command[2]
            baseline_value = baseline.get("scripts", {}).get(script)
            current_value = current.get("scripts", {}).get(script)
            if baseline_value != current_value:
                return f"npm script {script!r} changed since HEAD"
            return None
        if (
            len(command) == 2
            and command[0] in {"bash", "node"}
            and not self._path_matches_head(command[1])
        ):
            return f"gate executable {command[1]!r} changed since HEAD"
        return None

    def _path_matches_head(self, path: str) -> bool:
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", path],
            cwd=self.root,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", path],
            cwd=self.root,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        return result.returncode == 0 and tracked.returncode == 0


def _as_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value
