# Hardening follow-up: validate the persisted forecast store

A follow-up recorded in Q18 (R4-LOW-008) and selected by Bradley. Stacked on
PR #1777, which also edits `forecast-calibration-adapter.ts`.

## What changed

- **The problem:** `loadPersisted` in `forecast-calibration-adapter.ts` cast
  whatever `localStorage['crystalball-forecast-calibration-v1']` held to
  `PredictionRecord[]`. A corrupt or tampered entry could then reach Brier
  scores, champion/challenger gates and resolver inputs.
- **The fix:** new `src/services/intelligence/forecast-calibration-load.ts`
  rebuilds each record from its known fields only.
  - **Required fields:**
    - `id`, `sourceId` and `domain` must be non-empty strings, and `claim`
      a string;
    - `probability` must be a finite number from 0 to 1;
    - `predictedAt` and `resolveBy` must be finite numbers;
    - `status` must be one of the four known values.
  - **Optional fields, each checked:**
    - `targetKey`, `resolvedAt`, `resolutionNote` and `algorithmVersion`;
    - `criteria`, only with a known `kind`;
    - `resolutionProvenance`, only with a direct or proxy kind, and only
      object evidence entries.
  - **Everything else:** unknown fields are dropped, invalid records are
    skipped, and the result is capped to the newest `MAX_RECORDS` by
    `predictedAt`.
- **Adapter:** `loadPersisted` now calls
  `parsePersistedPredictions(parsed, MAX_RECORDS)`.

## Tests

- `src/services/intelligence/__tests__/forecast-calibration-load.test.mts`
  (3 tests):
  - invalid entries are dropped at load;
  - unknown fields never survive, and nested shapes are checked;
  - corrupt or non-array blobs load as empty, and the cap keeps the newest.
- The existing adapter and evidence-journal suites still pass (35 tests in
  total).
- New script: `test:forecast-load`.

`bash scripts/agentic-validate.sh --tests "test:forecast-load test:evidence-journal"`
on the Mac printed "Agentic validation gate passed." It covered lint:strict,
typecheck:all, secrets:scan, cross-agent:check, docs:check, roadmap:check,
the build, and both suites (all passing). Changed-file ESLint is clean.

## Mutation proof (8 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| L01 | blob cast again | red (1 failing), restored `e9dabcbd20b9` |
| L02 | probability range unchecked | red (1 failing), restored `6d64f37a8efa` |
| L03 | any status accepted | red (1 failing), restored `6d64f37a8efa` |
| L04 | unknown fields kept | red (1 failing), restored `6d64f37a8efa` |
| L05 | any criteria kind kept | red (1 failing), restored `6d64f37a8efa` |
| L06 | any provenance kind kept | red (1 failing), restored `6d64f37a8efa` |
| L07 | no cap | red (1 failing), restored `6d64f37a8efa` |
| L08 | non-object evidence kept | red (1 failing), restored `6d64f37a8efa` |
