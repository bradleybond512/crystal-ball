# Q18: durable calibration evidence (R4-LOW-008)

Status: **approved by Bradley on October 3, 2026** with every recommended
option (A: sidecar journal; B: scored fields only; C: the three core stores;
D: export now, import later).
Based on `main` (`a255546ee`). None of the open `claude/*` PRs touch these
files, so this PR stands alone.

Standard+: it adds a new sidecar write route and a new store of user data.

## Problem (verified on `main`)

The "70% means 70%" principle depends on outcome evidence. All of it lives
only in WebKit `localStorage`, behind rolling caps, with no export:

| Store | Key | Cap | What it holds |
|---|---|---:|---|
| `intelligence/forecast-calibration-adapter.ts` | `crystalball-forecast-calibration-v1` | 500 | The ACC truth spine: every forecast, its probability and its resolution (Brier, skill, promotion gates) |
| `intelligence/outcome-ledger.ts` | `wm-outcome-ledger` | 2,000 | What you did with each alert (dismissed, acted on, false positive, …) |
| `forecast-accuracy.ts` | `crystalball-forecast-accuracy-v1` | 100 | EMA forecast hit/miss, plus running totals |

Findings beyond the scan text:

- **There is no sidecar evaluation store.** The ACC roadmap calls
  `forecast-calibration.ts` the "durable" record, but its adapter persists to
  `localStorage` too, capped at 500. So the scan's first option (document the
  sidecar store) doesn't exist. The second option is needed.
- **The caps silently delete evidence.** At 500 forecasts the oldest are
  dropped, so long-run calibration and matched-cohort comparisons lose their
  history without any signal.
- **`forecast-accuracy.ts` trusts its blob.** It does
  `JSON.parse(raw) as AccuracyStore` with no shape check. A corrupt value
  makes `getForecastAccuracy()` throw. Fixed here as part of the rebuild.
- **The sidecar's data folder is excluded from Time Machine on purpose.**
  `exclude_app_data_from_backup` marks the app data folder because it holds
  plaintext intelligence data. A sidecar store there survives a WebKit reset,
  but not a lost disk. Only an export protects against that.
- **`events.db` sets the privacy precedent.** Its payloads are allowlisted:
  no entity names, no free-text titles, no exact coordinates.

## Design (recommended options shown)

1. **A sidecar evidence journal (`evidence.db`).**
   - Built with `node:sqlite` beside `events.db`, using the same WAL setup.
   - **Append-only, enforced by the database itself.** SQLite triggers abort
     any `UPDATE` or `DELETE`, so a code bug can't rewrite history.
   - **Each record change is a new row** keyed by `(kind, record_id,
     digest)`. A resolution appends a second row for the same forecast.
   - **Hash-chained.** Each row stores `sha256(prev_hash ‖ canonical row)`.
     Startup verifies the chain and reports `chain: ok | broken@seq` in
     diagnostics. This detects corruption and partial edits. It does not stop
     someone who rewrites the whole file; that limit is documented.
   - **No rolling cap.** At roughly 300–800 bytes per entry, even 50,000
     entries a year is about 40 MB. A hard ceiling (256 MB) refuses new
     appends with a visible diagnostics error. It never deletes quietly.
2. **Scored fields only** (decision B).
   - A journal entry keeps what the calibration maths needs:
     - IDs, domain, source, probability, status and outcome;
     - timestamps and algorithm version;
     - the resolver ID, the provenance kind (direct or proxy), and the
       note's `direct:`/`proxy:` prefix class, which calibration code uses to
       exclude proxy labels.
   - *Implementation note:* the criteria type and the evidence count were
     dropped. A rebuilt record can't carry them, so projecting it again would
     produce a different digest and re-append a degraded row. Every
     projected field survives a rebuild, and a test pins that.
   - **Target keys are stored as SHA-256 digests.** Champion/challenger
     pairing still joins on them.
   - **Region labels stay**, because forecast-accuracy needs them to resolve.
     They are coarse place names.
   - **Not stored:** claim text, resolution notes, evidence references,
     outcome notes, driver scores, coordinates.
   - The sidecar validates every entry against a per-kind allowlist:
     - known kinds only;
     - finite numbers, probability within 0–1;
     - capped strings;
     - at most 4 KB per entry and 200 entries per batch;
     - unknown fields dropped.
3. **Routes.** All require the bearer token.

   | Route | Purpose |
   |---|---|
   | `POST /api/local-evidence/append` | Add entries (idempotent; each entry accepted or rejected on its own) |
   | `POST /api/local-evidence/missing` | Given `(kind, id, digest)` triples, return the indexes the journal lacks |
   | `GET /api/local-evidence/records?kind&before_seq&limit` | Page newest-first through entries, for rebuilding |
   | `GET /api/local-evidence/summary` | Counts per kind, chain status, size |
   | `GET /api/local-evidence/export` | JSONL export |

   - *Implementation note: why `/api/local-`.* The desktop fetch patch
     (`runtime.ts`) retries any `/api/*` request against the **cloud** API
     when the sidecar is unreachable. The only exceptions are `/api/local-*`
     paths and a short reviewed list. The sidecar has the same rule for its
     own fallback.
     - Under `/api/evidence/`, an outage could have sent evidence off the
       machine.
     - The `/api/local-` prefix makes both layers treat these routes as
       local-only.
     - The client also refuses any base URL that isn't an `http` loopback
       origin.

   - All five are added to the traffic-recorder skip list, so evidence
     requests are never logged.
   - The routes return 503 when the store failed to start, as `/api/events/*`
     does.
   - No MCP tool is added, so agents can't write evidence (consistent with
     Q15).
4. **The renderer keeps its ledgers as fast working copies.** The calibration
   maths and its windows don't change.
   - **Write path.** Every `record`, `resolve` or `expire` in the three stores
     also queues the scored entry to the journal. It is fire-and-forget and
     never blocks the UI.
   - **Reconcile.** This runs at boot, when the sidecar becomes ready, and
     every 15 minutes:
     - it sends the working set's `(kind, id, digest)` triples, at most about
       2,600 of them, to `/missing`, then posts whatever is missing;
     - the local ledger acts as the outbox, so anything written while the
       sidecar was down is caught up;
     - on the first run this backfills today's evidence immediately.
   - **Rebuild.** When a local ledger is empty, fails its checksum, or lacks
     journal records:
     - the newest *N* entries per store (*N* = the store's cap) are folded
       back in, newest digest first, deduplicated by record ID;
     - rebuilt forecasts show "claim not retained" in place of the text.
5. **Export.**
   - A "Export calibration evidence" button in Belief Calibration downloads
     a JSONL file, using the existing `utils/export.ts` path.
   - The file starts with a header line: schema version, counts, chain head
     hash and export time.
   - Import is a separate, later item (decision D).

## Decisions for you

| | Recommended | Alternatives |
|---|---|---|
| **A. Where the durable record lives** | Sidecar `evidence.db` journal | Native Rust JSONL behind a Tauri command (survives sidecar outages, but adds native IPC surface); export only (smallest change, keeps the caps) |
| **B. What an entry holds** | Scored fields only, target keys hashed | Full records (complete rebuild, including claim text, but more sensitive text at rest and in exports) |
| **C. Which stores** | The three above | Also algo-eval, hypothesis, correlation, source, cluster and credibility feedback, and the champion registry (about 2.5× the work; listed as a follow-up); only the two the scan named |
| **D. Backup and restore** | Keep the Time Machine exclusion; the export is the backup; import comes later | Export *and* import now (a new untrusted-file path: strict validation plus a chain check); keep `evidence.db` in a backed-up folder |

## Tests (fakes only; mutation proof per behavior)

- **`evidence-store` unit tests, against a temporary SQLite file:**
  - the append-only triggers;
  - idempotent appends;
  - chain verification, including a detected tamper;
  - the ceiling refusal;
  - paging;
  - the missing-entry diff.
- **Sidecar route tests:**
  - the auth gate;
  - per-kind validation, including dropped fields, rejected kinds and
    out-of-range numbers;
  - the batch and size caps;
  - 503 when the store is down;
  - the traffic-recorder skip.
- **Renderer tests:**
  - the scored projections carry no claim, note or coordinate (a privacy
    fixture);
  - reconcile posts only the missing entries;
  - rebuild after a simulated WebKit reset;
  - a corrupt forecast-accuracy blob no longer throws;
  - the export header and its line format.
- **A boundary test** pins the five routes, the skip list and the absence of
  any MCP tool.
- New script `test:evidence-journal`, added to the targeted-test overrides.

## Out of scope / follow-ups

- Journaling the other evidence stores (decision C, alternative 1).
- An import UI (decision D).
- Feeding ACC matched-cohort evaluation from the full journal history, beyond
  the renderer caps. That changes calibration behavior, so it belongs on the
  ACC roadmap.

## Approval requirement

Implementation starts only after Bradley answers A–D.
