# Key-comparison hardening: comparison-only portion of #1783

This candidate applies only the independently approved comparison changes on
accepted main `2e81b693352347ce7410ce898e7f78af8833fee9`. It does not complete the
full #1783 proposal. Qualified #1769/#1778 integration and auth-policy context,
plus the four event-store routes absent from accepted main and their local-only
routing, remain dependencies of the held full-scope work.

## Implementation and preserved policy

`api/_timing-safe.js` compares primitive strings using full `codePointAt` values
at every UTF-16 index, including the low half of surrogate pairs. It folds a
length mismatch into an accumulator and visits both strings through the full
maximum code-unit length. Missing positions become zero under bitwise XOR;
the length mismatch distinguishes absent positions from NUL characters.
This preserves JavaScript string equality for Unicode, including
distinct lone surrogates. Encoding first with TextEncoder would replace lone
surrogates with U+FFFD and could falsely report equality.

Malformed or missing non-string operands return false. The collection helper
rejects missing or non-iterable collections and visits every configured entry,
including entries after a match. It adds no dependency or Node crypto API.

The production auth edits are mechanical: one app-key inequality and the two
API-key `Set.has` comparisons call the helpers. Existing origin regexes,
fetch-metadata rules, read-method exemptions, env names, split/filter/Set
configuration semantics, errors, statuses, response bodies, and CORS headers
are preserved. In particular:

- `validateApiKey` captures whether `LOCAL_API_MODE` contains the lowercase
  substring `sidecar` at module import. It also retains the import-time
  production/development loopback policy.
- `requireAppAuth` dynamically bypasses on a truthy `LOCAL_API_PORT`, returns
  the existing 403 response when the app key is unconfigured, returns the
  existing 401 response for missing or invalid keys, and returns null for an
  exact configured key.

No #1778 mode/options policy, event-store route, or runtime-routing change is
included. The existing `api/_api-key.test.mjs` is byte-for-byte unchanged
(SHA-256 `6cdb890c4c64ff7d07dbb8600d70c82b9d9e1145e8124a8315bd985ed09e2dd7`).

## Timing and transport limits

These are best-effort full-traversal comparisons, not a mathematically
guaranteed wall-clock constant time in JavaScript/JIT runtimes. Work depends on
the compared string lengths and configured key count. The implementation avoids
explicit exits at the first mismatching code unit or first matching key; it
does not make a measured timing or remote-exploit claim.

Request headers are ByteStrings: the Request constructor rejects code units
above 255. The unrestricted Unicode and lone-surrogate cases are direct helper
tests. Auth behavior uses realistic ASCII/Latin-1 request headers. No observed
remote surrogate-header bypass is claimed.

## Tests-first evidence

Tests were written before the final helper or auth-callsite changes. Accepted
main has no comparison helper, so a missing-module import would not establish
the surrogate defect. Instead, the exact proposed TextEncoder helper from
`1e275b49b0d3773165dd21ac086a3b6dcf3e3ab1` was temporarily bootstrapped into the
allowed new helper path, while both accepted auth files remained unchanged.

On Node `v22.23.1`, with `/opt/homebrew/opt/node@22/bin` prepended to PATH and
`TMPDIR=/private/tmp/cb-pr1783-comparison-validation-kfrv7m4o`, the actual command
`npm run test:key-compare` returned exit 1:

```text
# tests 51
# suites 0
# pass 38
# fail 13
# cancelled 0
# skipped 0
# todo 0
```

Six named equality assertions failed against that defective proposed-helper
baseline: distinct lone high surrogates; distinct lone low surrogates; lone high
versus lone low surrogate; lone high surrogate versus replacement character;
lone low surrogate versus replacement character; and embedded distinct lone
surrogates. Other failures exercised strict membership, collection rejection,
full code-unit traversal, and the three still-unmodified auth comparisons.
This is evidence against a proposed helper, not an accepted-main auth failure.

Private evidence contains the exact defective helper and tests snapshots, its
applied diff, the empty accepted-auth diff, raw output, command, exit, counts,
and source/log hashes in `tests-first.proposed-helper-red.receipt.json`. The raw
log `tests-first.proposed-helper-red.log` has SHA-256
`28c293358752fdf828691ecd4055a3db435649d83f0bcf90ed59102834ae1966`.

## Focused implementation validation

After fixing the helper and callsites, the same command and Node/TMPDIR context
returned exit 0:

```text
# tests 51
# suites 0
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The 41 new tests cover exact equality, prefixes, length differences, NULs,
ASCII, Latin-1, Unicode, combining versus precomposed forms, astral characters,
lone surrogates, malformed inputs, all-entry generator traversal, current app
auth responses, current API-key origin/method/configuration rules, and both
accepted sidecar behaviors. The command also runs the 10 unchanged existing
API-key tests. Temporary prototype instrumentation, restored in `finally`,
checks the full loop and all three auth callsites behaviorally. Requests are
constructed before instrumentation.

The raw log `implementation.focused-green.log` has SHA-256
`f10c445c1d01c1dcd33988c53ce6aa12a4471505cee123fce291fbdd8b3a346d`.
`implementation.focused-green.receipt.json` records the command, exit, counts,
and source hashes. These logs and receipts are private evidence outside the
source checkout.

`test:key-compare` runs only the new comparison suite and existing API-key
suite; it excludes the old UCDP/runtime tests. Additive selector mappings choose
`test:key-compare` and `test:api` for the three auth/helper modules and
`test:agentic-pipeline` when the overrides file itself changes. Existing
mappings and selector execution/baselines are preserved.

## Root qualification and clean mutation proofs

The implementation's first normal commit attempt was rejected by the existing
`unicorn/prefer-code-point` lint rule. The helper and temporary traversal
instrumentation were changed to `codePointAt` at every UTF-16 index. Full values
are retained: masking a code point to 16 bits can make an astral character
compare equal to a different BMP/lone-low-surrogate sequence. One added
regression guards that case. No lint rule or assertion was weakened.

The updated focused suite, including the 10 unchanged API-key tests, reports:

```text
# tests 52
# pass 52
# fail 0
# skipped 0
```

The normal repository hooks then passed on local commit
`85036bde622d43634b865ed5ba96f0b579bd5e99`, without changing source. This supplied
a clean baseline for the following actual mutations. Each applied diff was
captured, the focused suite executed, and all seven file hashes, HEAD, staged
index entries and clean status verified after restoration.

| Applied mutation | Actual pass / fail | Exit |
| --- | --- | --- |
| Reintroduce TextEncoder normalization | 40 / 12 | 1 |
| Stop the code-unit loop on its first mismatch | 47 / 5 | 1 |
| Stop membership scanning at its first match | 49 / 3 | 1 |
| Restore the plain app-key comparison | 51 / 1 | 1 |
| Restore both API-key `Set.has` callsites | 50 / 2 | 1 |
| Truncate compared code-point values to 16 bits | 51 / 1 | 1 |
| Restored candidate | 52 / 0 | 0 |

The UTF-8 mutation includes all six named surrogate failures. The first-match
mutation fails actual generator visitation and both API-key traversal guards.
The plain-comparison mutations fail their respective auth-callsite guards;
the truncation mutation fails the added astral/BMP case.

`clean-mutation-results.json` retains actual commands, counts, failure names,
applied diffs and hashes. The initial driver stopped on a serialized Git index
digest change. Its source bytes, staged content, HEAD and clean status were
verified unchanged; no old index was overwritten. The retained complete rerun
checks index entries and records raw digests, rather than claiming serialized
stat-cache bytes cannot refresh.

Before the Unicode method adjustment, `test:api` reported 257 pass / 0 fail,
and `test:agentic-pipeline` reported 75 pass / 0 fail. The actual selector probe
mapped each auth/helper file to both `test:key-compare` and `test:api`, the new
test to its suite, and the overrides file to `test:agentic-pipeline`, with no
unmapped paths. Root's inverse mechanical transforms reproduced both accepted
auth files byte-for-byte; existing origins, auth policies, protected files,
package data and mappings were preserved.

The final normal completion command reruns all affected suites on the updated
helper, then the lockfile, strict lint, type, secrets, local cross-agent, docs,
roadmap and frontend-build checks:

```sh
bash scripts/agentic-validate.sh --tests "test:key-compare test:api test:agentic-pipeline"
```

Actual output and exit status are retained privately in
`agentic-validation.log` and `agentic-validation.json`; final normal amend-hook
output is retained in `final-normal-commit.log`. Local cross-agent checking is
not an independent model review. The private candidate handoff records the
final frozen commit and the separate internal Sol review outcome. No external
review, publication or full #1783 delivery is claimed by this note.

Rollback is the bounded seven-file candidate diff. Auth policy is preserved;
rolling back would restore its previous comparison operations. Manual review
should confirm the three auth replacements and the two distinct sidecar rules
against accepted main, then inspect the completed root validation evidence.
