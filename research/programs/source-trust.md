# Source Trust

## Objective

Improve confidence quality by rewarding corroboration and authoritative sourcing.

## Editable Surface

- `src/config/feeds.ts`
- `src/services/threat-classifier.ts`
- `src/services/clustering.ts`
- `src/services/analysis-core.ts`
- `src/services/breaking-news-alerts.ts`

## Fixed Eval

- `npm run typecheck:all`
- `npm run test:data`

## Promotion Rule

Keep a change only if source weighting becomes more explainable and better aligned with alerting and clustering behavior.

## Fast Rejects

- Low-trust sources jumping to high urgency alone
- Opaque score jumps
- Changes that make clustering or alerts noisier
