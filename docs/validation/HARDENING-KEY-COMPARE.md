# Hardening follow-up: constant-time key checks, local-only event routes

A follow-up Bradley selected after Q20 ("Hardening follow-ups"). Stacked on
PR #1778 (Q19): that branch already changes `api/_api-key.js`, and its stack
changes `src/services/runtime.ts`.

## What changed

- **New `api/_timing-safe.js`:**
  - **`timingSafeEqualString`** compares the UTF-8 bytes of both strings over
    the longer length. Every difference is folded into one accumulator with
    no early exit, and the length is part of the result. Timing can reveal
    only the longer length.
  - **`timingSafeIncludes`** compares the candidate against every entry, so
    timing doesn't reveal which configured key matched.
  - It uses only `TextEncoder`, so it runs on Vercel edge, in the Node
    sidecar, and in the browser.
- **`api/_auth.js` (`requireAppAuth`):** compares `X-CrystalBall-Key` against
  `CRYSTALBALL_APP_KEY` with the helper, where it used to use `!==`.
- **`api/_api-key.js`:** checks keys against `CRYSTALBALL_VALID_KEYS` with
  `timingSafeIncludes`, where it used to use `Set#has`.
- **`src/services/runtime.ts`:** `/api/events/health|query|count|prune` are
  now explicitly reviewed local-only targets. The desktop fetch patch
  therefore never retries them against the cloud API: a cloud answer for
  `events.db` would be wrong, and query parameters must not leave the
  machine.

**Live effect:** none today. No cloud API is deployed, and the sidecar
already handles the event routes.

## Tests

- `tests/key-compare-hardening.test.mjs` (7 tests), covering:
  - equality semantics, including prefixes, trailing NUL bytes, Unicode and
    non-strings;
  - the multi-key search;
  - a structural pin that the loops never exit early;
  - the app-key gate and API-key matching;
  - the absence of plain comparisons.
- `src/services/__tests__/ucdp-runtime-boundary.test.mts`: one new behaviour
  test for the event routes.
- `api/_api-key.test.mjs`: unchanged and still passing.
- New script: `test:key-compare`.

`bash scripts/agentic-validate.sh --tests "test:key-compare test:latent-cloud test:api"`
on the Mac printed "Agentic validation gate passed." It covered lint:strict,
typecheck:all, secrets:scan, cross-agent:check, docs:check, roadmap:check,
the build, and all three suites (all passing). Changed-file ESLint is clean.

## Mutation proof (6 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| K01 | length difference ignored (prefix accepted) | red (1 failing), restored `b53b84e5228d` |
| K02 | early exit on first mismatch | red (1 failing), restored `b53b84e5228d` |
| K03 | includes stops at first match | red (1 failing), restored `b53b84e5228d` |
| K04 | app key compared with !== | red (1 failing), restored `160dd0445763` |
| K05 | API keys compared with Set#has | red (1 failing), restored `13011bdb9b3e` |
| K06 | event query not local-only | red (1 failing), restored `099e843dcaa0` |

K01 first **survived**: a byte loop treats a missing byte as 0, so `key`
and `key` plus a NUL compared equal without the length term. A trailing-NUL
case was added, and K01 then went red.
