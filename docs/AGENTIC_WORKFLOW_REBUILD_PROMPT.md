# Agentic Development Workflow — Rebuild Prompt

Portable spec for standing up the same supervised-agent engineering workflow in a
different repository (e.g. a work account). Everything below is repo-agnostic:
Crystal Ball specifics have been replaced with placeholders in `<angle brackets>`.

**How to use it:** open the target repository in Claude Code (or Codex), paste the
whole "Prompt" section below as your first message, and answer the questions it
asks in step 0. The agent builds the workflow into that repo as a PR.

---

## What this workflow is

A single unbounded coding agent is not the unit of work. Instead:

1. **Repository policy** (`AGENTS.md` / `CLAUDE.md`) — permanent, always-loaded rules.
2. **Narrow specialist subagents** with per-agent sandbox and permission posture.
3. **A workflow skill** that defines phase sequencing and handoffs.
4. **Executable local gates** — scripts an agent must run and cannot self-attest past.
5. **GitHub required checks** — the final merge authority, which measure the
   workflow's own definition of done rather than generic linting.

The load-bearing idea: *instructions guide behavior; executable checks enforce
reality.* Every rule that matters is backed by a script that fails.

Three enforcement mechanisms carry most of the weight, and they exist because
each replaced a rule that agents routinely evaded:

- **Named-tests validation gate** — the gate refuses to report success unless the
  agent names the test scripts it ran (or explicitly waives with a reason).
- **SHA-pinned review verdicts** — an approval is bound to a commit, so pushing
  new code invalidates it automatically.
- **Changed-path targeted tests in CI** — derived from `package.json`, never
  hand-maintained, so the mapping cannot drift into vacuous green.

---

## Prompt

Copy everything below this line into the agent.

---

You are setting up a supervised agentic engineering workflow in this repository.
Build it as a single PR on a fresh branch. Work through the steps in order.

### Step 0 — Interview me first

Before writing anything, inspect the repository (build tooling, package manager,
test runner, CI, branch protection, existing agent instruction files) and then ask
me these questions in one batch. Do not guess:

1. What is the canonical remote and default branch? Are there multiple remotes
   whose names differ between clones?
2. Which branch-name prefixes mark agent work (e.g. `claude/*`, `codex/*`,
   `copilot/*`)? Which agents are actually available to me?
3. Which parts of this codebase are **high assurance** — where a silent defect is
   expensive rather than annoying? (Typical: security boundaries, auth, payments,
   migrations, privileged/native IPC, release & deploy logic, anything whose
   output is a number someone trusts.)
4. What are the real validation commands — lint, typecheck, test scripts, build,
   secret scan, dependency/lockfile check? Give exact `npm`/`make`/`just` names.
5. Am I permitted to add required status checks and branch protection, or should
   the CI half be delivered as documentation for an admin to apply?
6. Do we have an API key available for a *second* model provider, so cross-agent
   review can run inside CI rather than being self-attested?

### Step 1 — Repository policy file

Create or extend the repo's agent instruction file (`AGENTS.md` for Codex,
`CLAUDE.md` for Claude Code; if both are used, make one the source of truth and
have the other point at it). It must contain these sections:

**Delivery path**

- The default branch is the only merge target.
- Agent branches go through PRs and auto-merge after required checks pass; never
  a local `git merge` or the REST merge endpoint.
- Every agent PR finishes with one closeout script (built in step 5), never by
  arming auto-merge by hand.

**Branch discipline**

- Never commit to local default branch. Every session starts from a fresh branch
  cut from the *freshly fetched canonical* default branch.
- Resolve the remote name programmatically rather than assuming it:

```bash
REMOTE=$(git remote -v | awk '/<org>\/<repo>.*\(fetch\)/{print $1; exit}')
git fetch "$REMOTE"
git checkout -b <prefix>/<feature-name> "$REMOTE/<default-branch>"
```

- Re-sync **before** the first commit, not after — parallel sessions move the
  base branch mid-task, and conflicts are cheapest while the work is still in
  the agent's head.

**Work classification** — three tiers, with routing consequences:

- *Fast*: isolated docs, copy, formatting, obvious one-file fixes.
- *Standard*: features, multi-file fixes, UI behavior, performance, tests.
- *High assurance*: everything named in my answer to question 3, plus
  dependencies, migrations, destructive operations, and architecture changes.
  High-assurance work **stops for human approval after design, before
  implementation**.

**Required sequence** for Standard and High Assurance:

1. Structured feature brief: goals, acceptance criteria, constraints, non-goals,
   unknowns, risk level, expected evidence.
2. Read-only repository discovery delegated to a `repository_analyst` agent.
3. Design delegated to an `architect` agent before any production edit.
4. Decompose into atomic tasks: owner, dependencies, allowed file scope,
   acceptance criteria, validation command, expected evidence.
5. Implementation delegated to the **narrowest** suitable specialist.
6. Behavior-focused tests for every behavior change, each with a mutation proof.
7. Targeted tests, then the validation gate naming those tests.
8. Complete diff delegated to `independent_reviewer` — never the implementer.
9. Repair confirmed findings. **At most two automatic review/repair cycles.** If
   a finding survives the second, stop and escalate to the human with both
   attempted repairs and why they failed. A third cycle, a quiet severity
   downgrade, and "pre-existing, out of scope" are the same failure: closing a
   confirmed finding without fixing it.
10. Draft PR summary. No push, merge, release, deploy, secret change, or
    production-data mutation without explicit human approval.

**Testing and validation rules**

- Never delete a test because it fails.
- Never weaken assertions, lint rules, type checking, secret scanning, or
  security tests to obtain a pass.
- If a command could not run, say why. Never claim it passed.
- Never assert coverage from reading code. A test you did not run is not a result.

**Mutation proof** (this section does the most work — write it in full):

> A green suite proves nothing about a test you just wrote. A test that passes
> both with and without the fix is worse than no test: it certifies a bug as
> fixed. Every behavior change ships a mutation proof:
>
> 1. Start from a clean tree (`git status --short` empty); record
>    `shasum -a 256` of the file to mutate.
> 2. Revert **only** the fix — the guard clause, the filter, the allowlist.
> 3. **Confirm the mutation applied by looking at `git diff`.** Non-negotiable:
>    an edit that silently matched nothing leaves the suite green and reads
>    exactly like a passing test.
> 4. Run the targeted suite; record the actual fail count and failing assertion.
> 5. Restore; verify the same checksum and an empty `git status --short`.
>
> Report before/after as numbers (`22 pass / 0 fail` → `19 pass / 3 fail`).
> "Tests confirm the fix" without a recorded red is not a mutation proof.

Add repo-specific mutation traps once you find them — e.g. tests that assert
against the *text* of another file guard the call site, not the function body, so
mutating the imported helper leaves them green.

**Completion report** — every finished task reports: summary and user-visible
behavior; files and architecture changed; validation commands with **actual
quoted output** (never paraphrased, never predicted, never a command not run);
mutation proof per behavior change; independent review outcome; unresolved risks;
manual verification steps; rollback considerations; proposed commit and draft PR text.

**Live-probe evidence** — if this repo consumes external APIs, add this section.
A read-only, offline reviewer can never catch *"this filter matches zero rows in
production."* Any change to an external data source must paste the live response
shape it was built against: request URL (secrets redacted), row count, and the
specific fields consumed. Probe the **body**, never the status code. Calibrate
numeric tolerances from a distribution of samples, never one.

Also encode the repo's own recurring defect classes here — the bugs that shipped
more than once. Write each as a rule with the reference implementation named.
Generic examples worth keeping unless clearly inapplicable:

- Filter untrusted external fields with **allowlists, never denylists**
  (`x !== 'normal'` admits `undefined`, a rename, and a typo; `MAP[x]` admits
  only what you have seen).
- Never truthiness-test a coordinate or numeric reading (`!lat || !lon` rejects
  longitude 0).
- Never cache a malformed-but-HTTP-200 body.
- Never report a component healthy on the basis of the raw fetch when the parsed
  output was empty — a fail-open phantom success is worse than a fail-closed miss.

### Step 2 — Specialist agent definitions

Create narrow agent definitions under the directory your agent runtime uses
(`.codex/agents/*.toml` for Codex, `.claude/agents/*.md` for Claude Code).
Baseline roster — rename the middle four to this repo's actual domains:

| Agent | Sandbox | Purpose |
|---|---|---|
| `repository_analyst` | read-only | execution-path and repository discovery |
| `architect` | read-only | design and tradeoff analysis |
| `<domain>_engineer` ×N | write | bounded implementation in one area each |
| `test_engineer` | write | behavior, regression, failure, and abuse tests |
| `independent_reviewer` | read-only | final correctness and risk review |

Each definition sets high reasoning effort, an explicit sandbox mode, and
developer instructions that state what it must return. Two are worth writing carefully:

**`repository_analyst`** — remain read-only; trace the *actual* execution path,
not a plausible one; always read the policy file first. Return: execution-path
summary; relevant files and symbols; patterns and invariants to preserve; risks
and unknowns; recommended implementation boundaries; targeted validation commands.
Do not implement. Do not propose replacing established architecture without
repository evidence.

**`independent_reviewer`** — review the final diff independently; inspect code,
tests, and execution path rather than relying on implementer claims. Prioritize
correctness, security boundaries, regressions, malformed and degraded inputs,
stale state, concurrency, performance, missing tests, architectural violations,
and unnecessary scope. Ignore style issues covered by automation. Critically,
**audit the evidence itself, not just the code** — treat each of these as a
finding: a new test with no mutation proof; a mutation proof whose diff was never
shown to have applied; a claimed command whose output is paraphrased rather than
quoted; an external-source change with no live response shape attached; a numeric
tolerance calibrated from a single sample. State plainly what it could not verify
(it is offline and read-only). Per finding: severity, confidence, file and symbol,
problem, concrete impact, evidence, recommended fix, and whether it blocks.
Return "No blocking findings" only after meaningful inspection.

Also set the runtime config (`.codex/config.toml` or equivalent): enable agents,
cap concurrent threads (~6), and state that subagents inherit the parent's
approval posture unless their own definition is stricter.

### Step 3 — The workflow skill

Create a skill at `.agents/skills/<repo>-feature-workflow/SKILL.md` (or your
runtime's skills path) with YAML frontmatter (`name`, `description`) whose
description names exactly when to use it and when not to ("do not use for trivial
copy, formatting, or isolated documentation edits").

Body = nine numbered phases, each a few lines: **branch and classify → intake →
discovery → design (human approval gate for high assurance) → task plan →
implement → integrate and validate → independent review → completion and
publication boundary.** State in phase 6 that each test is written first and
watched fail for the right reason; where that ordering was impossible, the
equivalent mutation proof is produced afterward. State in phase 7 the exact gate
invocation. State in phase 9 the closeout command and the publication boundary.

Keep it sequencing-and-handoffs only. The policy file stays authoritative; a skill
that restates policy drifts from it.

### Step 4 — The local validation gate

Create `scripts/agentic-validate.sh`. Design constraints, all of which came from
observed agent behavior:

- **It refuses to run without `--tests "<script names>"` or
  `--no-tests "<reason>"`.** A gate that runs no tests lets an agent truthfully
  write "validation gate passed" for a change whose behavior was never exercised.
- Validate every named script against `package.json` **before running any**, so a
  typo in the last name cannot burn minutes of real test time — and so a typo can
  never read as coverage.
- Split the `--tests` string into words before the emptiness check;
  `--tests "   "` is non-empty to `[ -n ]` but expands to zero words.
- Run the named tests **first**, then: lockfile check, strict lint, typecheck,
  secret scan, docs/consistency check, build.
- Unset any test seam env var the checks honor (a seam like `DOCS_ROOT=/var/empty`
  makes structural checks vacuously green if it leaks in from the environment).
- Capture command output into a variable rather than piping to `grep -q` — grep
  exits on first match, kills the producer with SIGPIPE, and `pipefail` reports 141.
- Print, on success, the tests it ran (or the waiver reason) **and** the line:
  *"This gate does NOT prove a new test fails without its fix — attach a mutation proof."*
- Demote to advisory any check that fails on a pristine default branch. A gate
  that is red before you touch anything teaches agents to ignore it.

### Step 5 — Review verdict protocol and closeout

**`scripts/verify-review-verdict.mjs`** — replaces the free-text "reviewed by"
marker in a PR body, which is self-attestable and never tied to a commit.

- The reviewer examines the branch at commit `R`.
- `--record --reviewer <agent> --evidence-file <transcript>` writes
  `.agentic/reviews/<R>.json` and commits it. That commit may touch nothing else.
- Verification (`--ci`) re-derives everything: HEAD is a verdict-only commit that
  only **adds or modifies** under `.agentic/reviews/` (diff with `--no-renames`,
  so a rename trick decomposes into a delete and is rejected); its first parent is
  exactly `R`; the file pins `R`; the reviewer is the **required cross-agent**
  (self-review rejected — map `claude/*` → codex, `codex/*` → claude,
  `copilot/*` → both); the verdict is approve with zero blocking findings; and
  quoted evidence is present and non-trivial.
- Consequence: pushing any code after the verdict makes HEAD a code commit again
  and the check goes red until a fresh review is recorded. **A stale approval
  cannot ride a new push into the default branch.**
- Document the known limit honestly: without CI-side reviewer execution, reviewer
  identity is attested by the recording agent. The protocol proves *what* was
  approved and *when it went stale*, not *who* approved it.

**`scripts/pr-closeout.sh`** — one command to finish an agent PR safely. In order:
refuse non-agent branches; refuse tracked uncommitted changes (ignore untracked —
worktree symlinks and evidence transcripts are not the shipped state); run the
verdict verifier; resolve the canonical remote and fetch; assert local tip ==
remote branch tip; fetch the PR and assert it is open, targets the default branch,
and its head OID equals the local tip; only then arm auto-merge. Arming by hand
skips all of it and loses the race.

### Step 6 — CI as the final authority

Add workflows. The non-obvious requirements:

**Cross-agent review gate** (`pull_request` on the default branch + `merge_group`).

- Checkout `github.event.pull_request.head.sha` explicitly — the default
  `pull_request` checkout is the *synthetic merge commit*, and the verdict
  protocol must examine the real branch tip. Use `fetch-depth: 0`.
- Skip inside `merge_group` (no PR context; already enforced at PR time).
- Non-agent branches pass.
- **Execute the verifier from the default branch, never from the PR head:**
  `git show origin/main:scripts/verify-review-verdict.mjs > "$RUNNER_TEMP/..."`.
  A PR must not be able to weaken or delete the gate that judges it.
- Two paths, strongest wins: if a second-provider API key and an opt-in repo
  variable are set on same-repo agent branches, run the reviewing model **in CI**
  and self-attestation becomes structurally impossible; otherwise verify the
  SHA-pinned verdict commit.
- Pin third-party actions by commit SHA.

**Targeted tests** — branch protection's required checks typically run no unit
tests at all, so a PR that breaks every suite merges green. Add
`scripts/targeted-tests.mjs` that selects the `test:*` scripts whose files or
covered source directories intersect the PR diff, and runs **all** of them, no cap
— a silently dropped suite cannot block a merge, which defeats the gate. Rules:

- **Derive the mapping from `package.json`**, never hand-maintain it: each
  eligible script lists its test files, and a test at `src/<area>/__tests__/*`
  covers `src/<area>/`. Hand-maintained mappings drift; derived ones cannot.
- Eligibility is an **allowlist** of plain test runners. Browser/e2e harnesses,
  composite `npm-run` chains, and bespoke runners are never auto-selected.
- Keep a small explicit `OVERRIDES` map for cross-file couplings the derivation
  cannot see (tests asserting against another file's *text*; scripts exercised by
  a suite that does not live beside them). Include the workflow's own scripts.
- Enforce an **index floor**: if a `package.json` change collapses the derived
  index below N scripts, refuse to certify rather than passing vacuously.
- Run it from the default branch's copy too — a PR must not control its own gate.

**Auto-PR for agent branches** — on push to the agent prefixes, open or update a
draft PR with generated metadata. Cap `git log` with `--max-count`, not
`| head -20`: under `-e -o pipefail`, `head` closes the pipe and the producer dies
of SIGPIPE (141), failing the step on long branches only.

Set `permissions:` to the minimum per workflow. Then make **cross-agent review**
and **targeted tests** required status checks alongside lint/typecheck/build.

### Step 7 — Documentation

Write `docs/AGENTIC_ENGINEERING.md`: the copy-paste task-start prompt, the agent
roster, the enforcement layers in order (policy → agent definitions → skill →
local gate → CI), the operating modes, and the safety boundary. State explicitly
which gaps the automation *cannot* close — typically that the gate cannot prove a
new test would fail without its fix, and that an offline reviewer cannot prove a
filter matches live data — and name the evidence the agent must attach for each.

### Step 8 — Verify and deliver

- Run the new gate against a trivial no-op change and confirm it refuses to pass
  without `--tests`/`--no-tests`.
- Confirm the verdict verifier rejects: a code commit at HEAD, a verdict pinning
  the wrong parent, a self-review, and a verdict commit touching an extra file.
- Confirm targeted-test selection picks the right suites for a sample diff.
- Add tests for the workflow scripts themselves — they are the enforcement layer,
  so they need the same standard of proof as product code.
- Open a **draft** PR with the completion report described in step 1.

Do not push, merge, or change branch protection without my explicit approval.

---

## Adapting notes

- **Two agents are the minimum.** Cross-agent review needs a reviewer that is not
  the implementer. With one provider, the protocol degrades to "what was approved
  and when it went stale" — still worth having, but say so out loud.
- **Start with steps 1, 4, and 5.** Policy plus a gate that cannot be self-attested
  past delivers most of the value. The specialist roster and CI half can follow.
- **Every rule should cost something to violate.** Rules with no failing script
  behind them are decoration, and agents learn to route around them.
- **Write rules from actual incidents.** The clauses that hold are the ones that
  name the bug, the count, and the reference implementation — not the ones that
  state a general principle.
