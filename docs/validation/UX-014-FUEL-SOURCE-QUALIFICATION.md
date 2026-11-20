# UX-014 — France fuel source qualification

Decision: do not approve a current operational-status adapter yet. Public reuse rights and feed publication freshness are established; recent per-record confirmation, authoritative withdrawal semantics and raw timestamp interpretation are not. Keep fuel operational/inventory/power/access unknown. This checkpoint changes documentation only; no application behavior or stored data changed.

## Public sources

- Official schema and direct Open Licence link: https://www.prix-carburants.gouv.fr/index.php/rubrique/opendata/
- Licence text: https://www.data.gouv.fr/pages/legal/licences/etalab-2-0
- Mirror metadata: https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2
- Operator-declaration methodology: https://www.prix-carburants.gouv.fr/disponibilites-carburants
- Official FAQ acknowledging potentially unreported station closures: https://www.prix-carburants.gouv.fr/rubrique/faq/

The official source labels rupture as shortage OR non-distribution. Its schema documents start/end and temporary/definitive types. The public methodology attributes availability data to station operators. Neither page supplies a guarantee that each retained row has been reconfirmed recently. Do not substitute the price-update date or HTTP retrieval date.

## Complete origin probe

URL: https://donnees.roulez-eco.fr/opendata/instantane_ruptures

Receipt: 2026-11-20T03:58:31.350323Z through 03:58:36.080699Z, using actual machine/response UTC (not the prompt date).

HTTP 200; Last-Modified 2026-11-20T03:50:26Z. ZIP 1,222,460 bytes; exactly one XML member, 14,285,996 bytes. SHA-256: 9b8a30cbab6eac7d12b66770d74ef94d2fce54228917cdcbc586b7224e61d675.

Parsed all 9,824 station rows. 23,490 rupture elements: 19,392 definitive, 3,075 temporaire, 1,023 empty type. None had a nonempty fin. No fermeture elements appeared. Root has no attributes; station attributes are cp,id,latitude,longitude,pop. Rupture attributes are debut,fin,id,nom,type. Temporary report start years range from 2017 through 2026. This is a complete file parse, not proof of complete geographic coverage or current ground truth.

The downloaded XML contains retained reports with blank ends, not a new confirmation timestamp for every report. Their presence is evidence that the publisher continues to include a declaration; it is not evidence of a recent operator confirmation. Absence in a later file would justify withdrawing our prior source assertion only after completeness/identity checks; it would not establish fuel availability or station reopening. No later-snapshot removal was observed during this bounded probe.

## Mirror metadata and timezone

The metadata probe returned 9,824 records; data_processed and modified were 2026-11-20T03:53:28.752000+00:00. Publisher is DGCCRF; licence is Licence Ouverte v2.0 (Etalab); timezone is Europe/Paris. Documentation says origin refreshes every 10 minutes and mirror harvesting every 15 minutes. These timestamps describe processing/publication, not per-row observation.

Raw XML start dates have no timezone offset. Prior mirror records exposed flattened date strings with +00:00 while retaining offset-free text. Dataset timezone alone does not establish the transform used for each raw date, particularly at DST boundaries. Do not infer UTC or apply a second conversion until the contract is resolved.

## Rights

The origin explicitly places these downloads under the linked Open Licence. The mirror independently declares Etalab 2.0. Official licence text permits copying, adaptation, redistribution and commercial reuse, with source attribution and the last-update date, without implying governmental endorsement. Attribute DGCCRF / prix-carburants.gouv.fr, link the source and licence, and distinguish publication time from report start and retrieval. The linked PDF fetch reset; the official HTML licence was readable. No credentials or account were used.

## Remaining decision boundary

A safe live operational integration still needs an authoritative interpretation of active/withdrawn reports, correction/omission handling, confirmation-age semantics, raw timestamp conversion and a defensible expiry contract. Do not invent a 7/30/60-day TTL from third-party practices. Blank types must be rejected; definitive non-distribution must not become a temporary shortage; one fuel must not become station-wide inventory=out. A fresh mirror/ZIP cannot reset old declarations' ages.

Smallest honest next step: retain this qualification receipt and obtain an explicit producer contract/public operator documentation addressing those gaps, or select another source exposing observation/confirmation timestamps. No contact has been made. An old start date does not prove the declaration is invalid: it may describe a still-active condition. A separate product decision could authorize an age-labeled source notice (the publisher includes a temporary shortage declaration with this start date, seen in this snapshot) while current status remains unknown. This would not assert the event is resolved or ongoing in the physical world, and would not complete UX-014 operational evidence. No provider implementation or completion claim is recommended from this evidence alone.

## Saved evidence

origin-snapshot.raw and origin-snapshot-receipt.json contain the bounded complete download, HTTP headers, hash and parsed counts. mirror-metadata.raw, mirror-metadata.json and mirror-metadata-receipt.json retain the exact metadata response and decoded form. licence-receipt.json records the failed PDF request. No rows were written into application storage. No dependencies were installed.

## Targeted declaration-instruction follow-up

The official public guide https://www.prix-carburants.gouv.fr/rubrique/guide/ says declarations occur in a secured interface reserved to station managers; its public instructions describe price changes and consumer features, not an explicit rupture-removal/replenishment lifecycle. The official schema defines debut as the rupture start date and fin as end date if provided; these are event dates, not confirmation timestamps. The official availability methodology uses operator declarations, but the inspected public pages do not specify a confirmation heartbeat, authoritative omission/withdrawal rules, or raw XML timestamp timezone. No account was opened and no operator contacted. Targeted public searches did not establish those contracts; this is a bounded-search limitation, not proof that no documentation exists.

Recommendation: documentation-only qualification checkpoint, with provider implementation and UX-014 acceptance explicitly open. Preserve the distinction between a declaration retained in a newly published snapshot and a recently confirmed operational condition.

## Local verification and review status

Parent independently reparsed the retained complete ZIP with bounded size checks;
the SHA-256, byte sizes, all row/type counts, zero end dates and zero closure
elements match the architect receipt. Raw evidence remains in the current Codex
task artifacts under `next-nov18b/ux014-qualification/`; it is not application data.
The prior JSON-record probes supplement this complete-file evidence but do not
establish representative freshness or complete geographic coverage.

`npm run test:roadmap-controller` produced `# pass 135`, `# fail 0` and
`# cancelled 0`. The complete named gate also passed:

```sh
bash scripts/agentic-validate.sh --tests "test:roadmap-controller"
```

Actual output:

```text
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:roadmap-controller
```

Lockfile consistency, strict lint, both TypeScript configurations, secret scan,
cross-agent configuration, docs/roadmap checks and web build exited zero.
Existing changelog/roadmap advisories and Vite loader/chunk warnings remain.
The complete live roadmap snapshot selects UX-014 with `blocking: []` after
carrying forward the already-reviewed UX-076 merged-PR metadata reconciliation.
Final exact-tip independent reviews and publication approval remain required.
No new executable behavior is added, so there is no new behavior mutation claim.
Provider and installed acceptance remain open. Manual verification can reproduce
the bounded public download and inspect retained report dates separately from
file publication. Rollback removes documentation only. See the
[bounded decision](../plans/2026-11-19-ux014-fuel-qualification.md).
