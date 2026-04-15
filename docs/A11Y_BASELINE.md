# Accessibility Baseline (TODO-019)

## Purpose

`e2e/a11y-baseline.spec.ts` runs [axe-core](https://github.com/dequelabs/axe-core)
against a curated list of panels and records the **current** violation count
per panel in `e2e/a11y-baseline.json`.

This is a **characterization** tool, not a remediation tool. Existing
violations are expected and accepted as the starting point. The baseline's
job is to make sure new work does not make accessibility *worse* while the
full remediation pass (TODO-019 Phase 2) grinds the numbers down.

## Regenerating the baseline

After an intentional panel change that legitimately alters the violation
count (for example, adding or removing a panel, or landing a remediation
batch that drops the count), regenerate the snapshot:

```bash
UPDATE_A11Y_BASELINE=1 npm run test:e2e:runtime -- a11y-baseline
```

Commit the updated `e2e/a11y-baseline.json` alongside the code change.

## CI behavior

- If the current violation count for a panel is **greater than** the recorded
  baseline, the test **fails**. This catches regressions introduced by new
  markup or component changes.
- If the count is equal or lower, the test passes. Driving the count down is
  welcomed but not enforced here — that is the job of the remediation pass.
- New panels without an entry in the baseline emit a warning (not a failure)
  until their first `UPDATE_A11Y_BASELINE=1` run.

## Remediation methodology

Use [`docs/REFACTOR_SAFETY.md`](./REFACTOR_SAFETY.md) as the playbook for
actually driving the violation counts down. Treat each panel's baseline as
a ratchet: every remediation batch should lower at least one panel's count
and regenerate the baseline in the same commit.
