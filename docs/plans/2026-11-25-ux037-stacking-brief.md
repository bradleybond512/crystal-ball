# UX-037 — prevent new unowned stacking levels

Discovery and design only. The roadmap controller selects UX-037 [C] after
UX-016's draft #1922 claim; all higher eligible tasks have claims or holds.

Goal: inventory intentional stacking contexts and propose a reviewed ratchet
that prevents new unowned levels without changing modal, focus or critical
banner behavior. Identify existing scanners, inline styles and CSS tokens,
baseline limitations, owner records and the smallest enforceable rule.

Acceptance: preserve current rendering and focus; detect newly introduced
unowned declarations and reject stale/invalid exceptions using fixture tests
with mutation proofs. Do not silently treat a raw number as global ordering:
stacking contexts may isolate equal values. Inventory observed ownership and
leave unknown relationships explicit.

Non-goals: visual redesign, mass z-index conversion, dependency changes, live
app/profile access, merging, auto-merge, releases, deployment or installation.
Leave separate dependency PR #1920 in its existing workflow.

Workflow: read-only repository analyst traces scanner and stacking usage;
architect proposes bounded design and exact files/owners/tests. Any new CI
enforcement policy requires human approval before implementation/publication.
The parent prepares the reviewable design. No production or policy edits yet.
