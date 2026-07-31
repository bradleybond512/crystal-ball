from __future__ import annotations

import fnmatch
from pathlib import PurePosixPath
from typing import Any


class PlanPolicy:
    def __init__(self, plan: dict[str, Any]) -> None:
        self.allowed_patterns = self._patterns(plan)
        self.approval_gates = sorted(set(plan.get("approval_gates", [])))

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

    def _patterns(self, plan: dict[str, Any]) -> list[str]:
        patterns: list[str] = []
        for task in plan.get("tasks", []):
            for raw_pattern in task.get("allowed_files", []):
                pattern = raw_pattern.replace("\\", "/")
                path = PurePosixPath(pattern)
                if (
                    not pattern
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
                if pattern not in patterns:
                    patterns.append(pattern)
        return patterns
