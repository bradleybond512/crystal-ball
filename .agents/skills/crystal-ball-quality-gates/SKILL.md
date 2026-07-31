---
name: crystal-ball-quality-gates
description: Use after implementation to select the cheapest sufficient deterministic lint, type, test, security, benchmark, and build checks before spending tokens on independent review.
---

# Crystal Ball Quality Gates

1. Run the narrowest domain test while coding.
2. Run `bash scripts/agentic-check-changed.sh` when the diff is ready.
3. Do not spawn the independent reviewer until deterministic checks pass.
4. Run `bash scripts/agentic-validate.sh` only for broad, high-assurance, release, or architecture changes.
5. Do not ask an agent to find formatting, import, JSON, YAML, Markdown, conflict-marker, lockfile, type, or secret errors that existing tools can find.
6. Do not rerun unchanged expensive suites after documentation-only repairs.
7. Cache and reuse command results within the same commit SHA; invalidate results when relevant files change.
8. A failed gate blocks completion. Never weaken the gate to make the change pass.

## Review handoff

Give the reviewer only the final diff, approved design, acceptance criteria, test results, and known risks. Ask for correctness, security, architecture, performance, and missing-test findings—not style feedback covered by tooling.
