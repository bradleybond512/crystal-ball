---
name: crystal-ball-automated-pipeline
description: Run Crystal Ball coding work as an automated routed builder, deterministic validation, independent review, and bounded repair pipeline. Use for all nontrivial implementation work.
---

# Crystal Ball Automated Pipeline

Read `.codex/MODEL_POLICY.md`, `AGENTS.md`, and the task-router output before delegation.

For executable orchestration, use:

```bash
python3 -m tools.agentic_pipeline start \
  --request "<task>" \
  --branch "codex/<branch>"
```

The Python runtime owns the durable ledger, Codex invocations, budgets,
approvals, validation ordering, repair attempts, and independent review. Do not
manually reproduce those stages when the runtime is available.

## 1. Route

Run:

```bash
node scripts/agent-router.mjs --request "<task>"
```

Use its minimum sufficient agent and test set. Do not add agents without a concrete risk or domain reason.

## 2. Plan

For Standard and High Assurance work, delegate discovery and planning to the assigned planning agents. Architecture, mission, prediction, correlation, and security planning use GPT-5.6 Sol. High Assurance work requires human design approval before production mutation.

Create a pipeline ledger entry with:

- task ID
- builder agent
- builder model and effort
- allowed files
- acceptance criteria
- targeted validation commands
- maximum automatic repairs: 2

## 3. Build

Delegate each bounded task to exactly one owning builder. Parallelize only disjoint file ownership. The builder owns its code until the task passes or is escalated.

## 4. Deterministic validation

Run code before reviewer agents:

```bash
bash scripts/agentic-check-changed.sh
```

Then run task-specific tests and benchmarks. Capture stdout, stderr, exit code, command, and changed files.

## 5. Failure handoff

Every failure is returned to the original builder as a structured repair packet:

```yaml
attempt: 1
builder: provider_engineer
model: gpt-5.6-terra
failure_class: test
command: npm run test:providers
exit_code: 1
summary: normalized concise failure
relevant_output: bounded log excerpt
changed_files: []
constraints:
  - do not weaken tests
  - do not modify validation scripts
  - remain within original scope
```

The validator and reviewer remain read-only. They never repair production code themselves.

## 6. Repair loop

1. Builder repairs confirmed failure.
2. Rerun the failed command first.
3. If it passes, rerun changed-file validation.
4. Maximum two automatic repair attempts.
5. On a second failed repair, raise reasoning effort one level when supported.
6. On a third failure, delegate read-only diagnosis to a Sol agent, stop automatic mutation, and report the blocker.

## 7. Independent review

After deterministic gates pass, delegate the final diff to `independent_reviewer`. Route specialist reviews only for touched risk domains. Confirmed findings return to the owning builder through the same repair packet.

## 8. Completion

Completion requires:

- all deterministic gates pass
- targeted tests and benchmarks pass or have an explicit approved exception
- no blocking independent-review findings
- pipeline ledger contains model, effort, attempts and outcomes
- PR summary states actual validation, risks and rollback

Do not push, merge, release, install, deploy, change secrets, or perform destructive operations without explicit approval.

The manual GitHub Actions workflow may publish only when its
`publish_changes` dispatch input is explicitly enabled. High-assurance design
approval is recorded through a separate resume dispatch.
