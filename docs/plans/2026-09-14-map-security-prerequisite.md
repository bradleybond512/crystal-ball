# Map security prerequisite

Status: local implementation authorized by Bradley's “fix whatever you need.
Lets get it done” following the reported critical/high dependency blockers.
No publication or installation is authorized by this local repair plan alone.

## Brief and discovery

Clear nine audit entries without breaking maps or weakening checks. Four root
issues are humanfs, sharp, fflate and MapLibre. Existing #1716 patch work is
reused; #1713's MapLibre decision is the starting point, not a claim that its
failed checks passed. This isolated prerequisite preserves UX-026's runtime
repair branch. No new feature or ACC/UX claim is introduced.

The repository analyst inspected manifests, lockfile, advisories and existing
PRs. An architect traced the old overlay's dependence on `map.transform`, which
MapLibre 6 removes. Upstream's supported integration uses MapLibreOverlay from
`@deck.gl/maplibre`, whose stable 9.4.0 peer graph requires deck/luma 9.4.

## Design and file ownership

The map specialist owns package manifests/lock, DeckGLMap, NavigationPanel,
one shared worker initializer and focused compatibility tests. Parent owns this
plan, evidence, integration and publication decision. Independent review must
cover the final source and runtime evidence.

Reuse #1716's humanfs 0.16.8, sharp 0.35.4/native companions and PostHog fflate
0.4.9 patches. Use MapLibre 6.9.0 from #1713, replace the incompatible mapbox
adapter with `@deck.gl/maplibre` 9.4.0, and align direct deck/luma requirements.
Declare already-used supercluster 8.0.1 and its existing types explicitly.
Apply a loaders-compression-scoped fflate 0.7.5 override only if its vulnerable
0.7.4 pin remains. Avoid unrelated tooling changes and forced audit downgrades.

Both map constructors must receive the same Vite-emitted, same-origin worker
configuration before initialization. Use supported namespace/named MapLibre
imports. Keep interleaving, public component interfaces, map protocols, stored
preferences and fallback behavior unchanged. Expand source scope only for
demonstrated compatibility failures and record the evidence.

## Dependency justification and risk

MapLibre addresses the critical sanitizer advisory. The new upstream-maintained
MapLibreOverlay replaces an adapter relying on removed internals; peer alignment
is required compatibility work. MapLibre uses BSD-3-Clause, deck/luma and the
adapter MIT, supercluster ISC, types/fflate MIT, and sharp/humanfs Apache-2.0.
No new product capability is added. The main risks are worker packaging, native
WebGL2/CSP compatibility, overlay interactions, offline tiles and bundle growth.

## Acceptance and verification

Use a clean Node 22 install, lock check, zero-advisory audit and valid dependency
peers. Run types and changed-file lint, targeted map/emergency-pack/lifelines
tests, renderer regression and the full agentic gate. Exercise real production
worker loading under existing CSP, full/tech/finance maps, clustering, layers,
clicks, zoom/pan, style replacement, navigation and offline startup/protocols.
Run a local sharp decode/encode smoke and verify nested fflate resolutions.

Keep the 460 KiB entry, 1200 KiB chunk and 6 MiB total JS budgets unchanged.
Measure successful production builds; a compile failure is not a bundle-size
measurement. Do not blindly accept new visual goldens. New behavior tests need
real red/green results and clean-tree mutation proofs. Independent review and
the real opposite-agent review precede any publication verdict.

## Non-goals, rollback and delivery

No forecasting, new layers, CSP relaxation, interleaving removal, app installation,
profile work or UX-025 diagnostics. No data migration. Keep the dependency graph
and compatibility changes atomic; rollback would reintroduce vulnerabilities and
is only an emergency response, not successful completion.

Keep existing dependency PRs intact while validating this consolidated candidate.
Reconcile their final scope and supersession only during reviewed delivery.
Once a reviewed prerequisite reaches main, refresh UX-026 and rerun its gates.
