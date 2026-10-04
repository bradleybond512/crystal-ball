# Q20 PR A validation: sidecar lows (R3-SEC-006, R3-SEC-007, R4-LOW-004)

Plan: `docs/plans/2026-10-04-q20-remaining-lows.md`, approved by Bradley on
October 4, 2026 (four PRs by area). Based on `main`.

## What changed

- **R3-SEC-006: the SMS webhook fails closed.**
  - With SMS enabled and no `TWILIO_AUTH_TOKEN`, a caller without the bearer
    token gets 503 "Twilio signature required". The check runs before the
    body is read.
  - The in-app test path (bearer token) and signed Twilio webhooks are
    unchanged.
- **`/api/sms/config` validates every change** (`validateSmsConfigPatch` in
  `sms-security.mjs`). Only these are accepted:
  - `enabled`, as a boolean;
  - `allowlist`: at most 25 entries of `{ phoneNumber, name, tier }`.
  - **Numbers:** new or changed ones must be E.164 once spaces, dashes, dots
    and parentheses are stripped (`+1 (555) 000-0000` becomes
    `+15550000000`). Numbers already saved are kept as they are, so an older
    config stays editable.
  - **Names:** at most 64 plain characters.
  - **Tier:** `admin` or `readonly`.
  - **Rejected:** unknown keys at either level return 400, and the body is
    capped at 64 KB.
  - The SMS settings panel now shows the reason when a save is refused.
- **R3-SEC-007:** new `fetchPinnedFollowingRedirects`. Every hop connects to
  the address `isSafeUrl` resolved for it, redirects are followed by hand and
  re-checked, and redirect chains stop after 3 hops. `/api/feed-discovery`
  uses it for the homepage fetch and the HEAD probes; the probes reuse the
  homepage's pinned address.
- **R4-LOW-004:** new `serializeForInlineScript`. It escapes `<`, `>`, `&`,
  U+2028 and U+2029 so a payload can't close the Patreon callback's inline
  script. The value still parses back identically.
- **Lint cleanup:** fixed pre-existing lint errors in `sms-security.mjs`
  (nested ternary, callback references), because CI lints touched files.

## Tests

- `src-tauri/sidecar/__tests__/q20-sidecar-lows.test.mjs` (9 tests). The
  sidecar is imported with `HOME` pointed at a temporary directory, so the
  real `~/.config/crystalball` is never read or written.
- Existing SMS suites still pass (101 tests).
- New script: `test:sidecar-lows`.

`bash scripts/agentic-validate.sh --tests "test:sidecar-lows test:sms test:sidecar"`
on the Mac printed "Agentic validation gate passed."

| Suite | Result |
|---|---|
| `test:sidecar-lows` | 54 pass, 0 fail |
| `test:sms` | 101 pass, 0 fail |
| `test:sidecar` | 643 pass, 0 fail |

Changed-file ESLint with `--max-warnings=0` is clean.

## Mutation proof (16 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| A01 | webhook accepted without Twilio token | red (1 failing), restored `e13a726a6fc6` |
| A02 | unknown config keys accepted | red (1 failing), restored `de033c2a5bb1` |
| A03 | phone not checked as E.164 | red (2 failing), restored `de033c2a5bb1` |
| A04 | saved legacy numbers rejected | red (1 failing), restored `de033c2a5bb1` |
| A05 | allowlist uncapped | red (1 failing), restored `de033c2a5bb1` |
| A06 | control characters in names | red (1 failing), restored `de033c2a5bb1` |
| A07 | any tier accepted | red (1 failing), restored `de033c2a5bb1` |
| A08 | config spread unvalidated | red (1 failing), restored `e13a726a6fc6` |
| A09 | '<' left raw in inline script | red (1 failing), restored `e13a726a6fc6` |
| A10 | U+2028 left raw | red (1 failing), restored `e13a726a6fc6` |
| A11 | callback back to JSON.stringify | red (1 failing), restored `e13a726a6fc6` |
| A12 | hops not pinned | red (1 failing), restored `e13a726a6fc6` |
| A13 | redirect targets not re-checked | red (2 failing), restored `e13a726a6fc6` |
| A14 | fetch follows redirects itself | red (1 failing), restored `e13a726a6fc6` |
| A15 | hop limit loosened | red (1 failing), restored `e13a726a6fc6` |
| A16 | homepage fetch unpinned | red (1 failing), restored `e13a726a6fc6` |

All 16 were rerun against the final test file in one pass. Before that,
A11's failure message had printed the whole sidecar source and overflowed
the runner's buffer. The source pin now fails with a short message.

## Residual risks and follow-ups

- **IPv6-only hosts** stay unpinned, the same as `/api/rss-proxy` (the
  resolver hook only pins IPv4).
- **The SMS panel's new save-error line** has no component test; the repo
  has no SMS panel harness yet.
- **Status table:** the R3 doc's table lives on the handoff branch, so mark
  R3-SEC-006/007 and R4-LOW-004 there when it merges.
