# R4-LOW-008 validation: durable calibration evidence

Plan: `docs/plans/2026-10-03-r4-low-008-durable-calibration-evidence.md`,
approved by Bradley on October 3, 2026 with every recommended option
(A: sidecar journal; B: scored fields only; C: the three core stores;
D: export now, import later). Based on `main` `a255546ee`.

## What changed

- **`src-tauri/sidecar/evidence-store.mjs`** (new): `evidence.db` on
  `node:sqlite`, beside `events.db`, using WAL with `synchronous = FULL`, a
  2 s busy timeout and file mode 0600.
  - **Append-only:** `BEFORE UPDATE` and `BEFORE DELETE` triggers abort.
  - **Idempotent:** rows are unique on `(kind, record_id, digest)`, and the
    digest is computed by the sidecar.
  - **Hash chain:** a meta row tracks the head hash and row count.
  - **No pruning:** a 256 MB ceiling refuses new appends rather than
    deleting.
  - **Allowlists:** per kind (`forecast`, `alert-outcome`, `ema-forecast`,
    `ema-forecast-totals`). Unknown fields are dropped and invalid entries
    are rejected one at a time, with value-free reasons.
- **`local-api-server.mjs`:** five bearer-gated routes under
  `/api/local-evidence/` (`append`, `missing`, `records`, `summary`,
  `export`).
  - Bodies are capped at 1 MB.
  - They answer 503 when the store failed to open.
  - The traffic recorder skips them.
  - The store opens at startup and closes with the server.
- **Why the `/api/local-` prefix:** both the renderer's fetch patch and the
  sidecar retry `/api/*` against the cloud API when the local handler is
  unreachable. `/api/local-*` is exempt from both fallbacks.
- **Renderer:**
  - `evidence-projection.ts`: scored projections and their inverses, plus
    the fold.
  - `evidence-journal.ts`: the client.
  - `evidence-journal-wiring.ts`: binds the three ledgers.
  - `evidence-bus.ts`: change notifications without an import cycle.
  - **Ledger hooks:** `outcome-ledger.ts`, `forecast-calibration-adapter.ts`
    and `forecast-accuracy.ts` gain a change notification and a deduplicating
    `mergeRebuilt…` method.
  - **Bug fix:** `forecast-accuracy.ts` now validates its stored blob, which
    was previously cast unchecked.
- **UI:** Belief Calibration gains an evidence-journal section. It shows
  counts, chain status, and warnings when the chain is broken or the journal
  is nearly full, plus "Export calibration evidence" (JSONL via the existing
  download path).
- **Bundle and config:**
  - `tauri.conf.json` bundles `sidecar/evidence-store.mjs`;
  - `.gitignore` covers `evidence.db*`;
  - new script `test:evidence-journal`;
  - targeted-test overrides for every touched source file.

## Privacy and safety properties (each pinned by a test)

- **Never stored or exported:**
  - claim text, resolution notes and evidence references;
  - outcome notes and driver scores;
  - coordinates.
- **Target keys and alert/situation IDs** are stored as `sha256:<hex>`.
- **Region labels** (coarse place names) are kept, because EMA resolution
  needs them.
- **Requests go only to an `http` loopback origin on an `/api/local-` path.**
  Outside the desktop app the client makes no request at all.
- **No MCP tool references the journal**, so agents can't write evidence.
- **Projection survives a rebuild unchanged.** A rebuilt record projects to
  the original digest, so a rebuilt ledger never re-appends. Proxy and direct
  label classes survive through the note prefix and provenance kind.

## Tests

`bash scripts/agentic-validate.sh --tests "test:evidence-journal test:sidecar"`
on the Mac printed "Agentic validation gate passed." The gate ran:

- lockfile;
- `lint:strict` (conflicts, JSON, YAML, shell, Markdown, colours);
- `typecheck:all`;
- `secrets:scan`;
- `cross-agent:check`;
- `docs:check`;
- `roadmap:check`;
- the production build.

| Suite | Result |
|---|---|
| `test:evidence-journal`, node part: `evidence-store` (14), `evidence-routes` (5), `evidence-journal-boundary` (7) | 26 pass, 0 fail |
| `test:evidence-journal`, tsx part: `evidence-journal.test.mts` (15), `evidence-journal-view.test.mts` (4) | 19 pass, 0 fail |
| `test:sidecar` (every sidecar instance now also opens `evidence.db`) | 643 pass, 0 fail |

Changed-file ESLint with `--max-warnings=0` is clean on every touched source
and test file.

Highlights:

- **End-to-end WebKit reset.** Records go into all three ledgers and are
  reconciled into a real `EvidenceStore`. Then `localStorage` and the
  singletons are wiped and the ledgers are rebuilt through the app wiring.
  Outcome stats, Brier score and EMA totals come back identical, claim text
  and notes do not, and a later reconcile appends nothing.
- **Digest agreement.** Renderer digests match the sidecar's byte for byte,
  including key order with mixed-case, numeric and accented keys.
- **Cloud and network guards.** Every route uses the `/api/local-` prefix,
  and non-loopback or browser-mode clients make no request.

## Mutation proof (42 mutations, all red, all restored by SHA)

Runner: `.worktrees/claude-q18-mutate.mjs` applies each mutation, runs its
suite, restores the file byte for byte, and checks the SHA-256.

| ID | Mutation | Suite | Result |
|---|---|---|---|
| S01 | drop UPDATE trigger | evidence-store | red (4 failing), restored `4a9101a5b404` |
| S02 | drop DELETE trigger | evidence-store | red (3 failing), restored `4a9101a5b404` |
| S03 | skip idempotency check | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S04 | verify ignores chain links | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S05 | verify ignores payload digest | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S06 | verify ignores head/count meta | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S07 | allowlist keeps unknown fields | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S08 | probability range unchecked | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S09 | control characters accepted | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S10 | size ceiling removed | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S11 | malformed triples reported present | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S12 | records oldest-first | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S13 | db file not chmod 0600 | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S14 | raw ids accepted where hashes required | evidence-store | red (1 failing), restored `4a9101a5b404` |
| R01 | traffic recorder logs evidence | evidence-routes | red (1 failing), restored `35115e436698` |
| R02 | method check removed | evidence-routes | red (1 failing), restored `35115e436698` |
| R03 | 1 MB body cap removed | evidence-routes | red (1 failing), restored `35115e436698` |
| R04 | 503 guard removed | evidence-routes | red (1 failing), restored `35115e436698` |
| B01 | journal never started | boundary | red (1 failing), restored `fd8089aa08e7` |
| B02 | store not bundled | boundary | red (1 failing), restored `969535eb0c26` |
| P01 | claim text projected | evidence-journal | red (3 failing), restored `204a961a89ee` |
| P02 | ids not hashed | evidence-journal | red (8 failing), restored `204a961a89ee` |
| P03 | proxy origin lost | evidence-journal | red (2 failing), restored `204a961a89ee` |
| P04 | locale-aware key order | evidence-journal | red (1 failing), restored `204a961a89ee` |
| P05 | non-loopback base accepted | evidence-journal | red (2 failing), restored `fd94a66efe97` |
| P06 | requests outside desktop | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P07 | confirmed memo not kept | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P08 | rejected memo not kept | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P09 | fold ignores rank | evidence-journal | red (1 failing), restored `204a961a89ee` |
| P10 | rebuild even when full | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P11 | outcome merge duplicates | evidence-journal | red (1 failing), restored `efaf1ef0e0cb` |
| P12 | forecast merge not deduped | evidence-journal | red (1 failing), restored `c2a5ab57d69e` |
| P13 | EMA merge duplicates | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P14 | blob cast unvalidated | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P15 | totals never adopted | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P16 | outcome ledger silent | evidence-journal | red (1 failing), restored `efaf1ef0e0cb` |
| P17 | forecast adapter silent | evidence-journal | red (1 failing), restored `c2a5ab57d69e` |
| P18 | EMA store silent | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P19 | export message unescaped | evidence-journal-view | red (1 failing), restored `276d5d6d9e66` |
| P20 | export never disabled | evidence-journal-view | red (1 failing), restored `276d5d6d9e66` |
| P21 | alert id not hashed | evidence-journal | red (2 failing), restored `204a961a89ee` |
| P22 | rebuilt note loses prefix | evidence-journal | red (2 failing), restored `204a961a89ee` |

P07 first **survived**: no test covered an entry the journal already held
being confirmed from the `/missing` answer. I added "entries the journal
already holds are confirmed by one query and never re-queried", and P07 then
went red. After the busy-timeout change, S01–S14 were rerun against the final
file (SHA `4a9101a5b404`).

## Residual risks and follow-ups

- **The 4 KB per-entry cap can't be reached with today's field caps** (the
  largest entry is about 1.5 KB). It is defence in depth for future fields,
  so it has no mutation proof.
- **The hash chain detects partial edits, inserted rows and a removed tail.**
  It cannot detect someone rewriting the whole file consistently.
- **Rebuilt records have limits:**
  - Pending forecasts lack resolution criteria, so they expire rather than
    auto-resolve.
  - Their target keys are hashed, so a forecast that spans a reset won't
    pair with a live record for the same target.
- **Import of an export file** is decision D's follow-up. It is a new
  untrusted-input path and needs its own review.
- **Pre-existing:**
  - `forecast-calibration-adapter.ts` `loadPersisted` casts stored records
    without validating them.
  - `EventStorePanel`'s `/api/events/*` routes are not local-only (GET
    health only, so no data leaves).
- **Journaling the other evidence stores** is decision C's follow-up:
  - algo-eval;
  - hypothesis, correlation, source, cluster and credibility feedback;
  - the champion registry.
- **The R4 doc status table** lives only on the handoff branch, so update it
  when that branch merges.
