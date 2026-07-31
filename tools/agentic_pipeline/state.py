from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from .models import BudgetLimits, PipelineState
from .redaction import Redactor


class StateStore:
    def __init__(self, path: Path, redactor: Redactor | None = None) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS pipelines (
                pipeline_id TEXT PRIMARY KEY,
                request_key TEXT NOT NULL UNIQUE,
                version INTEGER NOT NULL,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS approvals (
                pipeline_id TEXT NOT NULL,
                gate TEXT NOT NULL,
                actor TEXT NOT NULL,
                approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (pipeline_id, gate, actor),
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(pipeline_id)
            );
            CREATE TABLE IF NOT EXISTS events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(pipeline_id)
            );
            """
        )
        self.connection.commit()
        self._secure_files()
        self.redactor = redactor or Redactor()

    def close(self) -> None:
        self.connection.close()

    def create_or_get(
        self,
        request: str,
        branch: str,
        budget: BudgetLimits,
    ) -> tuple[PipelineState, bool]:
        normalized = " ".join(request.split())
        request_hash = hashlib.sha256(normalized.encode()).hexdigest()
        request_key = hashlib.sha256(f"{branch}\0{normalized}".encode()).hexdigest()
        existing = self.connection.execute(
            "SELECT state_json FROM pipelines WHERE request_key = ?",
            (request_key,),
        ).fetchone()
        if existing:
            return PipelineState.from_dict(json.loads(existing[0])), False
        state = PipelineState.new(
            request=normalized,
            request_hash=request_hash,
            branch=branch,
            budget=budget,
        )
        payload = json.dumps(
            self.redactor.redact_value(state.to_dict()), sort_keys=True
        )
        self.connection.execute(
            """
            INSERT INTO pipelines (pipeline_id, request_key, version, state_json)
            VALUES (?, ?, ?, ?)
            """,
            (state.pipeline_id, request_key, state.version, payload),
        )
        self.connection.execute(
            """
            INSERT INTO events (pipeline_id, kind, payload_json)
            VALUES (?, 'created', ?)
            """,
            (state.pipeline_id, json.dumps({"request_hash": request_hash})),
        )
        self.connection.commit()
        self._secure_files()
        return state, True

    def get(self, pipeline_id: str) -> PipelineState:
        row = self.connection.execute(
            "SELECT state_json FROM pipelines WHERE pipeline_id = ?",
            (pipeline_id,),
        ).fetchone()
        if not row:
            raise KeyError(f"unknown pipeline: {pipeline_id}")
        return PipelineState.from_dict(json.loads(row[0]))

    def save(
        self,
        state: PipelineState,
        event: str = "state_updated",
        event_payload: dict[str, Any] | None = None,
    ) -> None:
        old_version = state.version
        state.version += 1
        payload = json.dumps(
            self.redactor.redact_value(state.to_dict()), sort_keys=True
        )
        cursor = self.connection.execute(
            """
            UPDATE pipelines
            SET version = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE pipeline_id = ? AND version = ?
            """,
            (state.version, payload, state.pipeline_id, old_version),
        )
        if cursor.rowcount != 1:
            state.version = old_version
            self.connection.rollback()
            raise RuntimeError("pipeline state changed concurrently")
        self.connection.execute(
            """
            INSERT INTO events (pipeline_id, kind, payload_json)
            VALUES (?, ?, ?)
            """,
            (
                state.pipeline_id,
                event,
                json.dumps(
                    self.redactor.redact_value(event_payload or {}),
                    sort_keys=True,
                ),
            ),
        )
        self.connection.commit()
        self._secure_files()

    def approve(self, pipeline_id: str, gate: str, actor: str) -> bool:
        cursor = self.connection.execute(
            """
            INSERT OR IGNORE INTO approvals (pipeline_id, gate, actor)
            VALUES (?, ?, ?)
            """,
            (pipeline_id, gate, actor),
        )
        self.connection.commit()
        self._secure_files()
        return cursor.rowcount == 1

    def has_approval(self, pipeline_id: str, gate: str) -> bool:
        row = self.connection.execute(
            """
            SELECT 1 FROM approvals WHERE pipeline_id = ? AND gate = ? LIMIT 1
            """,
            (pipeline_id, gate),
        ).fetchone()
        return row is not None

    def events(self, pipeline_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            SELECT kind, payload_json, created_at
            FROM events WHERE pipeline_id = ? ORDER BY event_id
            """,
            (pipeline_id,),
        ).fetchall()
        return [
            {"kind": kind, "payload": json.loads(payload), "created_at": created}
            for kind, payload, created in rows
        ]

    def _secure_files(self) -> None:
        for candidate in (
            self.path,
            Path(f"{self.path}-wal"),
            Path(f"{self.path}-shm"),
        ):
            if candidate.exists():
                os.chmod(candidate, 0o600)
