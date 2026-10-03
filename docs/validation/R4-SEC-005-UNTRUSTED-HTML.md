# R4-SEC-005 / R3-SEC-009 / R4-LOW-005 validation — untrusted data into HTML

Validated October 2, 2026 on branch `claude/r4-sec-005-untrusted-html`, which
is based on `main` (`a255546ee`). Approved design:
[plan](../plans/2026-10-02-r4-sec-005-untrusted-html.md). Bradley's choices:

- A: fix the named sites now; a repo-wide check comes later.
- B: hide invalid stored rows and remove them only on his click.
- C: reject a whole import if any row is invalid.

## Behavior

- **One validator** (`src/services/resource-inventory/schema.ts`) rebuilds
  every inventory row from an allowlist.
  - `id`: `^[\w-]{1,64}$`.
  - Bounded labels, with control and bidi characters removed.
  - Finite, non-negative amounts up to 10⁹.
  - A bounded consumption log and known thresholds only.
  - Unknown fields are dropped.
- **Import:** the file is capped at 5 MB and 5,000 items. Any invalid row, or a
  duplicate id, rejects the whole file with a plain message, for example
  "Import rejected: 1 of 2 items are invalid (first: item 2, id). Nothing was
  imported."
- **Stored rows** that fail validation are never rendered. A banner says how
  many are hidden, and **Remove them** deletes exactly those rows, only on a
  click. The panel no longer crashes on a bad row.
- **Rendering:**
  - Every cell, `data-id` and form value goes through the shared
    `escapeHtml`, which also escapes `'`.
  - Numbers are formatted before they are interpolated.
  - The form enforces the same length limits, and what it saves is validated
    too.
- **Survival Advisor** loads rows through the same validator, so only
  well-formed rows reach its advice and its AI prompt.
- **Feed numbers** (`src/utils/finite-number.ts`):
  - They are coerced at the provider boundary: the maritime adapter (AIS
    disruptions, density zones) and the unrest adapter (fatalities).
  - The map popups and the stock chip format them for display; a non-number
    renders as "—".
- **S2 Underground:** the Patreon error text is escaped.

### Found while testing: the Resource Inventory buttons never worked

`Panel.setContent` is debounced. The panel attached its click handlers
immediately after calling it, so they bound to the *previous* content and
every button was dead: Add, Import, Export, Edit, Delete, Use and Resupply.
The handlers now attach in `setContent`'s render callback, for both the list
and the edit form. M15 below pins this.

### Not changed here

- `src/app/country-intel.ts` still passes the raw stock values into its AI
  prompt string. That file has 32 lint errors that predate this change, and CI
  lints every touched file. The HTML sink (the modal) now formats the value.
- MapPopup has about 220 other unwrapped interpolations, mostly translated
  labels. The repo-wide ratchet check is a later queue item (decision A).

## Actual validation

All tests use fakes: happy-dom and an in-memory IndexedDB.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:untrusted-html` (new: validator, numbers, panel, popups/sinks) | 19/19 |
| `test:lifelines-map` (existing MapPopup suite) | 33/33 + 13/13 |

- `tsc --noEmit` and ESLint are clean on every changed file. `lint:colors`
  shows no increase.
- The agentic gate passed, including `lint:strict`, `typecheck:all`,
  `secrets:scan`, `docs:check` and `npm run build`.

## Mutation proof

Each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green. A first run was stopped because one
source-level assertion was too broad. The one file left mutated was restored
and re-verified against its recorded hash, and the full run was then repeated.

| # | Mutation | File (sha before) | Red test file(s) |
|---|---|---|---|
| M01 | any id accepted | `schema.ts` (`03c8ba165d43`) | schema (3), resource-inventory-untrusted (2) |
| M02 | non-number quantity accepted | `schema.ts` (`03c8ba165d43`) | schema (3), resource-inventory-untrusted (1) |
| M03 | control characters kept | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M04 | unknown fields kept | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M05 | any threshold accepted | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M06 | log unbounded | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M07 | partial import accepted | `schema.ts` (`03c8ba165d43`) | schema (1), resource-inventory-untrusted (1) |
| M08 | no size cap | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M09 | duplicate ids accepted | `schema.ts` (`03c8ba165d43`) | schema (1) |
| M10 | stored rows rendered unvalidated | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (1) |
| M11 | data-id unescaped | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (1) |
| M12 | name unescaped | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (1) |
| M13 | form value unescaped | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (1) |
| M14 | Remove deletes nothing | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (1) |
| M15 | handlers bound before render | `ResourceInventoryPanel.ts` (`e831d05a92c3`) | resource-inventory-untrusted (4) |
| M16 | Survival Advisor unvalidated | `survival-advisor.ts` (`3d07063c9158`) | untrusted-numeric-fields (1) |
| M17 | any string is a number | `finite-number.ts` (`630191311d11`) | finite-number (2), untrusted-numeric-fields (1) |
| M18 | formatter echoes its input | `finite-number.ts` (`630191311d11`) | finite-number (1), untrusted-numeric-fields (1) |
| M19 | negative counts kept | `finite-number.ts` (`630191311d11`) | finite-number (1) |
| M20 | AIS change raw | `MapPopup.ts` (`22a5a3d9cf49`) | untrusted-numeric-fields (1) |
| M21 | fatalities raw | `MapPopup.ts` (`22a5a3d9cf49`) | untrusted-numeric-fields (1) |
| M22 | maritime adapter passes raw | `index.ts` (`54770a72a137`) | untrusted-numeric-fields (1) |
| M23 | unrest adapter passes raw | `index.ts` (`4fa70060f22f`) | untrusted-numeric-fields (1) |
| M24 | stock change raw | `CountryIntelModal.ts` (`614548b43e26`) | untrusted-numeric-fields (1) |
| M25 | S2 error unescaped | `S2UndergroundPanel.ts` (`7dc75d30d6dd`) | untrusted-numeric-fields (1) |

All 25 mutations went red, with no survivors.

## Rollback

Revert the commit. Imports would again store unvalidated rows, and the panel
buttons would be dead again (the debounce bug).
