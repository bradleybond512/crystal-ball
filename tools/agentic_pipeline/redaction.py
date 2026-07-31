from __future__ import annotations

import re
from typing import Any


class Redactor:
    def __init__(self) -> None:
        self.patterns = [
            re.compile(
                r"(?i)\b(authorization\s*:\s*bearer)\s+[^\s]+"
            ),
            re.compile(
                r"(?i)\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)"
                r"\s*=\s*)[^\s]+"
            ),
            re.compile(r"(?i)(https?://[^:/\s]+:)[^@\s]+(@)"),
            re.compile(r"\b(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}\b"),
            re.compile(
                r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?"
                r"-----END [A-Z ]*PRIVATE KEY-----",
                re.DOTALL,
            ),
        ]

    def redact(self, text: str) -> str:
        redacted = text
        redacted = self.patterns[0].sub(r"\1 [REDACTED]", redacted)
        redacted = self.patterns[1].sub(r"\1[REDACTED]", redacted)
        redacted = self.patterns[2].sub(r"\1[REDACTED]\2", redacted)
        redacted = self.patterns[3].sub("[REDACTED]", redacted)
        redacted = self.patterns[4].sub("[REDACTED PRIVATE KEY]", redacted)
        return redacted

    def redact_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, list):
            return [self.redact_value(item) for item in value]
        if isinstance(value, dict):
            return {
                key: self.redact_value(item) for key, item in value.items()
            }
        return value
