from __future__ import annotations

import json
import subprocess
from typing import Callable

from .redaction import Redactor


START_MARKER = "<!-- agentic-pipeline:start -->"
END_MARKER = "<!-- agentic-pipeline:end -->"


class GitHubClient:
    def __init__(
        self,
        repository: str,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        redactor: Redactor | None = None,
    ) -> None:
        self.repository = repository
        self.runner = runner
        self.redactor = redactor or Redactor()

    def update_pr_body(self, pr_number: int, summary: str) -> None:
        view = self.runner(
            [
                "gh",
                "pr",
                "view",
                str(pr_number),
                "--repo",
                self.repository,
                "--json",
                "body,isDraft",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if view.returncode != 0:
            raise RuntimeError(
                f"failed to read PR #{pr_number}: "
                f"{self.redactor.redact(view.stderr)}"
            )
        pr = json.loads(view.stdout)
        if not pr.get("isDraft"):
            raise PermissionError("automated pipeline updates require a draft PR")
        body = self._replace_section(pr.get("body") or "", summary)
        edit = self.runner(
            [
                "gh",
                "pr",
                "edit",
                str(pr_number),
                "--repo",
                self.repository,
                "--body-file",
                "-",
            ],
            input=body,
            text=True,
            capture_output=True,
            check=False,
        )
        if edit.returncode != 0:
            raise RuntimeError(
                f"failed to update PR #{pr_number}: "
                f"{self.redactor.redact(edit.stderr)}"
            )

    def _replace_section(self, body: str, summary: str) -> str:
        section = f"{START_MARKER}\n{summary.strip()}\n{END_MARKER}"
        if START_MARKER in body and END_MARKER in body:
            before, remainder = body.split(START_MARKER, 1)
            _, after = remainder.split(END_MARKER, 1)
            return f"{before.rstrip()}\n\n{section}{after}"
        return f"{body.rstrip()}\n\n{section}\n"
