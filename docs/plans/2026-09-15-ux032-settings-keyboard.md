# UX-032 — Settings keyboard containment

Risk: Standard frontend repair; medium QA risk.

## Objective

Make the packaged Settings dialog usable by keyboard without activating the
underlying Home or Classic interface. Native acceptance uncovered a missing
modal keyboard lifecycle in UnifiedSettings.

## Acceptance

- Focus enters Settings on open and stays within visible enabled controls.
- Escape closes only Settings, preserving the current Home/Classic view.
- Closing restores a connected invoker; repeated open/close remains stable.
- Dynamic tab content and nested place editing retain their established behavior.
- Dialog and close action have accessible names and modal semantics.

## Constraints and non-goals

Preserve settings values, existing preference storage, source feeds and native
commands. No new dependencies, global appearance changes, profile clearing,
materials experiment, or native permission changes. This is not full VoiceOver
or appearance sign-off. The installed app is already on main through background
sync; no install was performed by this acceptance pass.

## Evidence and unknowns

Native menu Settings opened on installed build ee2a7aaac9be; focus remained on
the HTML root. Tab then focused the background Safety review banner. Escape
closed Settings and switched Home to Classic. Home was restored. The installed
binary passed strict deep codesign verification; SHA-256:
47d42b4546fb3800746969bfa6f5ec64a2ba12ac4c50ae3adf3c0fcf0d632cde.

No disposable packaged profile switch is currently established. System-theme
and destructive-data fixture tests therefore remain unperformed on this user
profile. Native Settings menu opens correctly; the first shortcut attempt did
not open it, which remains an unconfirmed separate observation.

## Work plan

1. Repository analyst traces lifecycle, existing modal patterns and test harness.
2. Architect specifies bounded ownership and tests before implementation.
3. UI specialist owns UnifiedSettings and focused behavioral tests.
4. Parent runs relevant tests, all type checks, agentic gate, bundle policy and
   records applied-diff mutation proofs from a clean tree.
5. Independent reviewer assesses the diff; Claude supplies the exact-tip verdict
   before normal PR closeout. No direct merge or gate bypass.

Rollback: revert the bounded frontend change; no stored-data migration.
