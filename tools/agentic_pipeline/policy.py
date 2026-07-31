from __future__ import annotations

import fnmatch
from pathlib import PurePosixPath
from typing import Any


SENSITIVE_PATTERNS = {
    "control_plane": (
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        ".agents/**",
        ".claude/**",
        ".codex/**",
        ".github/**",
        "scripts/**",
        "tools/agentic_pipeline/**",
        "tests/agentic_pipeline/**",
    ),
    "release": (
        ".github/workflows/build-desktop.yml",
        "scripts/release-prepare.mjs",
        "src-tauri/tauri.conf.json",
    ),
    "secrets": (
        "scripts/backup-keys.mjs",
        "scripts/restore-keys.mjs",
        "src-tauri/src/commands/secrets.rs",
    ),
}


class PlanPolicy:
    def __init__(self, plan: dict[str, Any]) -> None:
        self.allowed_patterns = self._patterns(plan)
        inferred = self._required_gates_for_patterns(self.allowed_patterns)
        self.approval_gates = sorted(
            {*plan.get("approval_gates", []), *inferred}
        )

    def out_of_scope(self, changed_files: list[str]) -> list[str]:
        if not self.allowed_patterns:
            return []
        return sorted(
            path
            for path in changed_files
            if not any(
                fnmatch.fnmatchcase(path, pattern)
                for pattern in self.allowed_patterns
            )
        )

    def pending_gates(self, approved: set[str]) -> list[str]:
        return [
            gate
            for gate in self.approval_gates
            if gate != "publish" and gate not in approved
        ]

    def required_gates_for_paths(self, paths: list[str]) -> list[str]:
        required = []
        for gate, patterns in SENSITIVE_PATTERNS.items():
            if any(
                fnmatch.fnmatchcase(path, pattern)
                for path in paths
                for pattern in patterns
            ):
                required.append(gate)
        return sorted(required)

    def _patterns(self, plan: dict[str, Any]) -> list[str]:
        patterns: list[str] = []
        for task in plan.get("tasks", []):
            for raw_pattern in task.get("allowed_files", []):
                pattern = raw_pattern.replace("\\", "/")
                path = PurePosixPath(pattern)
                if (
                    not pattern
                    or pattern in {"*", "**", "**/*"}
                    or path.is_absolute()
                    or ".." in path.parts
                    or (
                        len(path.parts) > 0
                        and path.parts[0].endswith(":")
                    )
                ):
                    raise ValueError(
                        f"unsafe allowed_files pattern: {raw_pattern!r}"
                    )
                if not _literal_prefix(pattern):
                    raise ValueError(
                        "allowed_files patterns require a concrete path prefix: "
                        f"{raw_pattern!r}"
                    )
                if pattern not in patterns:
                    patterns.append(pattern)
            if "allowed_files" in task and not task["allowed_files"]:
                raise ValueError("allowed_files must not be empty")
        return patterns

    def _required_gates_for_patterns(
        self, patterns: list[str]
    ) -> list[str]:
        required = []
        for gate, sensitive_patterns in SENSITIVE_PATTERNS.items():
            if any(
                _patterns_overlap(pattern, sensitive)
                for pattern in patterns
                for sensitive in sensitive_patterns
            ):
                required.append(gate)
        return required


def _literal_prefix(pattern: str) -> str:
    wildcard = min(
        (pattern.find(character) for character in "*?[" if character in pattern),
        default=len(pattern),
    )
    prefix = pattern[:wildcard]
    if wildcard < len(pattern) and "/" in prefix:
        prefix = prefix[: prefix.rfind("/") + 1]
    return prefix.strip("./")


def _patterns_overlap(left: str, right: str) -> bool:
    left_prefix = _literal_prefix(left)
    right_prefix = _literal_prefix(right)
    return (
        left_prefix == right_prefix
        or left_prefix.startswith(f"{right_prefix}/")
        or right_prefix.startswith(f"{left_prefix}/")
        or fnmatch.fnmatchcase(left, right)
        or fnmatch.fnmatchcase(right, left)
    )
