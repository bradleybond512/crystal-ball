---
name: crystal-ball-automated-pipeline
description: Use for every nontrivial Crystal Ball software change so Claude and Codex share the same executable routing, model, validation, repair, review, and approval pipeline.
---

# Crystal Ball Automated Pipeline

The canonical workflow is
`.agents/skills/crystal-ball-automated-pipeline/SKILL.md`. Read it completely
before acting and follow its classification and approval rules.

Do not implement nontrivial work outside the executable
`tools.agentic_pipeline` runtime. Start or resume the runtime using the
repository CLI described in `docs/AGENTIC_ENGINEERING.md`. Claude may clarify
the request, report pipeline state, and summarize results, but must not replace
the routed builder, deterministic validation, independent review, repair, or
approval stages with an ad hoc workflow.

Use the same checked-in sources as Codex:

- `AGENTS.md`
- `.codex/model-policy.json`
- `scripts/agent-router.mjs`
- `scripts/agentic-validate.sh`
- `tools/agentic_pipeline/schemas/`

Never push, merge, auto-merge, release, deploy, access secrets or keychain
entries, perform destructive actions, or alter the control plane without the
corresponding explicit human approval.
