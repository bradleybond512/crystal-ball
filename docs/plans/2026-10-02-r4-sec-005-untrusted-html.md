# Q13: untrusted data into HTML (R4-SEC-005, R3-SEC-009, R4-LOW-005)

Status: **approved by Bradley on October 2, 2026** ("Approve as designed";
A: named sites now, repo-wide check later; B: hide, remove on click; C:
reject the whole file). Based on `main` (`a255546ee`); independent of the
other open PRs.

## Findings (verified at `a255546ee`)

### R4-SEC-005: inventory import is a stored-XSS path (Medium)

`ResourceInventoryPanel.ts`:

- **Unvalidated import.** It reads `JSON.parse(file) as ResourceItem[]` and
  stores anything with a truthy `id` and `name`. There is no type check.
- **Raw `id` in HTML.** `data-id="${item.id}"` goes into `innerHTML` on
  every render (4 buttons per row). A crafted id runs script in the main
  window, and the row persists in IndexedDB across restarts.
- **Crash on bad types.** `item.quantity.toFixed(1)` and similar assume
  numbers. One bad row throws during render, and the panel stays blank
  until the row is removed.
- **Weak escaping.** The local `_esc` misses `'`. `dailyRate` and the
  form's `quantity` / `dailyRate` values are interpolated raw.
- **Survival Advisor reads the same store.** It puts names into an AI
  prompt and calls `quantity.toFixed` without any check.

### R3-SEC-009: numeric feed fields interpolated raw (Low)

- `MapPopup.ts`: the AIS popup interpolates `changePct`, `windowHours`,
  `darkShips` and `vesselCount`; the protest popup interpolates
  `fatalities`. All come straight from the generated RPC types, and
  TypeScript types are not runtime checks.
- `CountryIntelModal.ts`: `weekChangePercent` is a string built with
  `String(resp.weekChangePercent)` and rendered raw.

### R4-LOW-005

- `S2UndergroundPanel.ts`: `error.message` goes into `setContent` unescaped.

## Design

1. **One validator** for inventory rows,
   `src/services/resource-inventory/schema.ts`. It is used by import, by
   loading stored rows, and by Survival Advisor.
   - `id` must match `^[A-Za-z0-9_-]{1,64}$`. Today's ids are
     `crypto.randomUUID()`, so they already match.
   - `name` is 1–120 characters; `unit` and `category` are 1–40 characters,
     with the existing defaults (`units`, `Misc`). Control characters are
     removed.
   - `quantity` and `dailyRate` must be finite numbers from 0 to 10⁹.
   - `lastUpdated` must be a finite timestamp.
   - `consumptionLog` holds at most 10,000 entries of
     `{ timestamp, amount }`, each finite.
   - `alertedThresholds` may only contain known values.
2. **Import** (decision C):
   - File size is capped at 5 MB and the item count at 5,000.
   - Any invalid row **rejects the whole file**, with a message like
     "Import rejected: 3 of 40 items are invalid (first: item 7, id)".
   - On success the panel shows "Imported 40 items".
3. **Stored rows** (decision B): rows that fail validation are not rendered,
   so the panel never crashes or runs their content. A banner shows "2
   stored items are unreadable and hidden", with a **Remove them** button.
   Nothing is deleted without that click.
4. **Rendering:** the panel switches to the shared `escapeHtml`, which
   escapes `'`. Every interpolation (`id`, numbers, form values) goes
   through it or through a finite-number formatter.
5. **Numbers at the provider boundary** (R3-SEC-009):
   - A new `src/utils/finite-number.ts` holds the coercion helpers.
   - The maritime adapter (`toDisruptionEvent`, `toDensityZone`) and the
     unrest adapter (`toSocialUnrestEvent`) coerce with `Number()` plus a
     finite check; anything else becomes `undefined` or 0, as the field
     allows.
   - `country-intel.ts` keeps the stock change as a number, and the modal
     formats it.
   - The popup sites also format through the helper, which renders `—` for
     non-finite values, so a bypassed boundary still renders safely.
6. **R4-LOW-005:** `escapeHtml(msg)`.

## Decisions for you

- **A. Scope of R3-SEC-009** (recommended: fix the named sites plus the
  boundary coercion now). A repo-wide check would flag unwrapped `${…}` in
  HTML templates. MapPopup alone has about 220, most of them safe labels.
  That check would be a separate queue item with a baseline ratchet, like
  `lint:colors`.
- **B. Stored rows that fail validation** (recommended: hide them, and
  remove them only when you click). The alternative deletes them
  automatically on load.
- **C. Import with some invalid rows** (recommended: reject the whole file,
  as the scan advises). The alternative imports the valid rows and lists
  the skipped ones.

## Tests (fakes only; mutation proof per behavior)

- **Validator:**
  - script-bearing id;
  - quote and angle-bracket names;
  - wrong types;
  - NaN and Infinity;
  - oversized strings, logs and files;
  - unknown thresholds;
  - legacy rows without `consumptionLog`.
- **Panel** (happy-dom, fake IndexedDB):
  - a poisoned stored row renders nothing executable and does not crash;
  - the banner and Remove flow work;
  - import accept and reject messages;
  - every `data-id` is escaped.
- **Survival Advisor** skips invalid rows.
- **Maritime and unrest adapters** coerce strings and NaN.
- **MapPopup and CountryIntelModal** render `—`, never markup, for
  non-numeric input.
- **S2Underground** escapes error text.

## Approval requirement

Implementation starts only after Bradley approves (decisions A–C).
