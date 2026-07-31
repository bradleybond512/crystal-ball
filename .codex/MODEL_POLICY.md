# Crystal Ball Model Policy

Use the least expensive model that meets the quality requirement. Model choice is part of the agent contract and may not be silently downgraded.

## Tiers

### GPT-5.6 Sol — frontier judgment

Use `gpt-5.6-sol` for work where an incorrect decision is expensive or where deep synthesis matters:

- architecture and system design
- mission and product strategy
- prediction, calibration, scoring, causal/correlation design
- security and trust-boundary review
- final independent review of high-assurance changes
- failure diagnosis after two unsuccessful repair attempts

Default effort: `high`. Use `xhigh` only for high-assurance design/review with measurable stakes. Reserve `max` for explicit escalation.

### GPT-5.6 Terra — production engineering

Use `gpt-5.6-terra` for most implementation and domain engineering:

- provider, intelligence, correlation implementation
- TypeScript, Rust/Tauri, UI/map, performance and benchmark work
- test design and repair
- integration and release preparation

Default effort: `medium`; use `high` for difficult multi-module implementation.

### GPT-5.6 Luna — high-volume bounded work

Use `gpt-5.6-luna` for deterministic or tightly bounded tasks:

- repository inventory and file classification
- documentation and ADR formatting
- lint/test failure summarization
- accessibility checklist passes
- routing, metadata extraction and PR-summary drafting

Default effort: `low` or `medium`. Luna must not make final architecture, security, prediction, destructive, or release decisions.

## Assignment table

| Agent | Model | Effort |
|---|---|---|
| architect | gpt-5.6-sol | high |
| mission_architect | gpt-5.6-sol | high |
| prediction_engineer | gpt-5.6-sol | high |
| correlation_engineer | gpt-5.6-sol | high |
| tauri_security_engineer | gpt-5.6-sol | high |
| independent_reviewer | gpt-5.6-sol | high |
| provider_engineer | gpt-5.6-terra | medium |
| intelligence_engineer | gpt-5.6-terra | high |
| ui_map_engineer | gpt-5.6-terra | medium |
| performance_engineer | gpt-5.6-terra | high |
| benchmark_engineer | gpt-5.6-terra | medium |
| product_designer | gpt-5.6-terra | medium |
| test_engineer | gpt-5.6-terra | medium |
| release_engineer | gpt-5.6-terra | medium |
| repository_analyst | gpt-5.6-luna | medium |
| architecture_memory | gpt-5.6-luna | low |
| accessibility_reviewer | gpt-5.6-luna | medium |

## Escalation rules

1. Start with the assigned model and effort.
2. A validator failure returns to the original builder on the same model.
3. A second failure may increase reasoning effort one level without changing models.
4. A third failure escalates diagnosis to Sol and stops automatic mutation until the diagnosis is incorporated into a new bounded repair task.
5. Never use Sol to perform linting, formatting, file enumeration, or other deterministic work.
6. Record model, effort, builder, validation command, failure class, and repair attempt in the pipeline ledger.
