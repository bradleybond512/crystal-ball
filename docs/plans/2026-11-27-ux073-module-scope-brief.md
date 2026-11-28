# UX-073 — one cohesive module extraction

High Assurance task approved November 27, 2026. The reconciled roadmap selects
UX-073 after UX-069's draft claim. Documentation draft publication and local
implementation are authorized; final code publication remains separate.

Goal: reduce a concrete coupling or edit risk with one behavior-preserving
extraction. Refresh large-module measurements, trace actual ownership/callers and
choose a small cohesive seam with existing characterization coverage.

Acceptance: document why the seam reduces risk, preserve imports/selectors and
runtime behavior, define mutation-backed characterization and comparable bundle
and performance checks. File length alone is not evidence of improvement.

Constraints: no map consolidation without caller evidence, no provider/prediction
policy changes, no dependencies or broad architecture rewrite, no arbitrary line
limit. Merging, auto-merge, releases, deployment, installation, cleanup and live
profile access remain held. Leave #1920's workflow alone.

Unknowns: current large-module sizes and ownership; candidate seams already
claimed in other drafts; characterization gaps; practical baseline comparison.

Owners: repository analyst measures and traces read-only; architect selects one
bounded design after discovery; parent reconciles claims and captures evidence.
Production implementation requires design and documentation-claim approval.
