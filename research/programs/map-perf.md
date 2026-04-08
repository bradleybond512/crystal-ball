# Map Perf

## Objective

Protect responsiveness under real map, layer, and background-refresh load.

## Editable Surface

- `src/components/MapContainer.ts`
- `src/app/refresh-scheduler.ts`
- `vite.config.ts`
- `src/services/persistent-cache.ts`
- `src/services/ml-worker.ts`

## Fixed Eval

- `npm run typecheck:all`
- `npm run test:e2e:runtime`

## Promotion Rule

Keep a change only if the app stays responsive or degrades more gracefully without reducing trust or determinism.

## Fast Rejects

- Higher polling without clear payoff
- Visual instability
- Heavier startup or map regressions
