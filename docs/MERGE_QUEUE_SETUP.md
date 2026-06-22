# GitHub Merge Queue — Setup & Operation

This repo uses GitHub's native **merge queue** for strict, serialized,
always-validated merges into `main`. The queue builds a temporary branch that
combines `main` + the queued PRs **in order**, runs the required checks against
that combined state, and only then fast-forwards `main`. This is the stronger
ordering guarantee over the lighter "auto-update branches" approach
(`auto-update-pr-branches.yml`): two PRs that each pass on their own but
conflict semantically when combined are caught *before* they land, not after.

## What the workflows already do

Every workflow that produces a **required status check** now also triggers on
the `merge_group` event:

| Workflow | merge_group | Notes |
|---|---|---|
| `cross-agent-review.yml` | ✅ | Passes trivially in-queue — see below |
| `eslint.yml` | ✅ | |
| `lint.yml` | ✅ | PR-diff markdown step skipped in-queue (no `base_ref`) |
| `typecheck.yml` | ✅ | |
| `smoke.yml` | ✅ | |
| `sast.yml` | ✅ | |
| `secret-scan.yml` | ✅ | |
| `bundle-size.yml` | ✅ | Path filter only applies to the PR trigger |
| `security-audit.yml` | ✅ | |
| `release-integrity.yml` | ✅ | |
| `actionlint.yml` | ✅ | |

> **Why this matters:** a required status check that does **not** fire on
> `merge_group` will never report against the merge-group ref, so the queue
> entry waits for it forever and the queue stalls. Adding `merge_group` to a
> *non-required* workflow is harmless — it runs informationally and never
> blocks. So the trigger is added to every gating workflow regardless of which
> are marked required, which is the safe default.

### Cross-agent gate special case

A `merge_group` event has no PR and no `head_ref`, so the cross-agent review
*marker* cannot be re-verified inside the queue. It doesn't need to be: the gate
is enforced when the PR is created/updated, i.e. *before* it can enter the
queue. In a `merge_group` event the job runs a single no-op step and reports
success, which keeps the required check green without weakening the PR-time
enforcement.

## One-time admin setup (must be done in repo Settings)

The `merge_group` triggers above are inert until the queue is actually enabled
on `main`. This is a branch-protection / ruleset toggle that **a repo admin
must set in the GitHub UI** — it cannot be flipped from a workflow or from
Claude's GitHub tools.

1. **Settings → Branches → Branch protection rules → `main`** (or **Settings →
   Rules → Rulesets** if you use rulesets).
2. Enable **Require merge queue**.
3. Under the merge queue settings:
   - **Merge method:** `Squash` (matches current practice) or `Rebase`.
   - **Build concurrency:** start at `1` for strict serialization; raise later
     for throughput once it's proven stable.
   - **Only merge non-failing pull requests:** on.
4. Keep **Require status checks to pass** on, and confirm the required-check
   list matches the workflows above (the job *names*, e.g. `Cluster: typecheck`,
   `Smoke`, `Cross-agent review marker`, …).
5. **Turn OFF "Require branches to be up to date before merging."** The queue
   makes each entry up-to-date inside its temporary branch; leaving this on
   forces redundant manual rebases and defeats the point of the queue.

## Interaction with the existing auto-merge workflows

- **`auto-merge-agent-branches.yml`** (#1217) — still correct. "Enable
  auto-merge" on a PR now means "add to the merge queue when checks pass," which
  is exactly the desired behavior.
- **`auto-update-pr-branches.yml`** (#1237) — becomes **redundant** once the
  queue is enabled, because the queue handles ordering and up-to-dateness
  itself. It's left in place (it no-ops when nothing is behind) so there's no
  gap during rollout. Once the queue is confirmed healthy, this workflow can be
  deleted or disabled to avoid duplicate branch-update churn.

## How to use it day-to-day

Nothing changes for contributors. Open a PR, get it green + reviewed, click
**Merge when ready** (or let auto-merge do it). GitHub adds it to the queue,
validates the combined result, and merges it in order. If the combined build
fails, GitHub kicks that PR out of the queue and continues with the rest.

## Rollback

Disable **Require merge queue** in the same Settings panel. The `merge_group`
triggers then simply never fire again — no workflow edits needed to revert.
