# Alerting

## Objective

Increase alert usefulness without increasing panic or noise.

## Editable Surface

- `src/services/breaking-news-alerts.ts`
- `src/components/BreakingNewsBanner.ts`
- `src/services/mode-manager.ts`
- `src/app/panel-layout.ts`

## Fixed Eval

- `npm run typecheck:all`
- `npm run test:e2e:runtime`

## Promotion Rule

Keep a change only if alert behavior becomes clearer, calmer, or more selective without breaking the runtime flow.

## Fast Rejects

- More alert spam
- Dramatic wording without clearer actionability
- Regressions in dismiss/cooldown behavior
