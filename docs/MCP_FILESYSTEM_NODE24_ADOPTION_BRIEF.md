# Filesystem-only Node 24 adoption: provisional stacked brief

## Objective and authority

Isolate the filesystem MCP server on the verified Node 24.22.2 runtime while
preserving the app and other MCP components on their existing runtimes and the
single explicit workspace boundary. High assurance: filesystem permissions,
installed-content trust and subprocess lifecycle. Bradley approved this design
with “Yes do it”; the architect selected the fixed home-based storage layout.
The approved design is DESIGN-v3.md, SHA256
d1f8d3858e03d5b8522027ba0e853145935c67154a8f785ceaf66e83435e2f74.

The original provisional stack on eb754706 is preserved externally. This owned
branch starts from actual merged inventory main 4432188fedbaba28938608cc07da6a25d11ca0c9. Publication requires reconciliation onto the actual merged inventory
successor, normal hooks, genuine cross-agent review and hosted gates. Original
PR #1781 and the frozen inventory worktree are untouched.

## Boundaries and non-goals

- Fixed os.homedir-based version/platform/content-digest storage; no production
  relocation, caller-selected manifest, latest pointer or fallback.
- Explicit canonical workspace, --confine-roots, no shell, no widening to tool
  storage/home, no launch-time install/download/repair or lifecycle scripts.
- Checked-in exact content trust, sanitized child environment, stderr diagnostics,
  protocol stdin/stdout, owned child signal/EOF/exit handling.
- No user data, client activation, global PATH/settings, Keychain, native app,
  release/deployment or vendored executable binaries.
- Unknown actual MCP consumer remains unknown. Expanded-template and synthetic
  protocol tests are not live-client compatibility evidence.
- Same-user concurrent writes remain a TOCTOU limitation, not an OS sandbox.

## Tasks, ownership and acceptance

Sole source writer: audit_remaining_security_prs. Architect refinement and prior
repository/provenance researchers are read-only. Current bounded preparation
writes this brief and tests only; no implementation, tests, provisioning or
package/runtime execution has occurred in this branch.

1. Contract tests: exact one-workspace template, canonical path rejection,
   fixed storage, no inherited code-injection/credential environment, exact
   Node/server/--confine-roots argv and fail-closed installed-byte verification.
2. Separate owned-process fixtures: actual no-shell argv, stdio, EOF, exit and
   TERM/INT/HUP forwarding/reaping. No real package until separate admission.
3. Authenticated disposable provisioning and real protocol matrix from the
   retained protocol plan: roots widening/withdrawal/races, symlink traversal,
   errors, read/write and cleanup. No actual user workspace or consumer.
4. Exact content manifest must be derived from genuinely qualified installed
   bytes, not a placeholder digest. Promote reserved inventory pair mandatory;
   preserve other six projects, unknown-path rejection and human-only bin label.
5. Normal hooks, meaningful clean mutations per new test, named aggregate,
   hosted full inventory gates and genuine review before publication.

## Tests-first interpretation and evidence

The existing template uses floating npx. Its direct assertion comparing command
and args to the approved explicit launcher can produce a genuine behavioral
red without importing a missing launcher. The other tests specify a future
internal contract module; import failure is setup evidence only and MUST NOT
be counted as a security red. Once the module exists, every meaningful behavior
requires an actual minimal reversal and restored green, not manufactured errors.
Pure fixture parameters are internal test seams, never production CLI overrides.
The production wrapper must bind os.homedir, platform and the checked-in manifest.

Current state: tests written, NOT RUN; no red/green/security claim. The first
proposed admitted execution is only the existing-template assertion under a
bounded Node22 test command with synthetic HOME/TMPDIR and no network/subprocess.
Full contract tests and real process/protocol tests need separate audited grants.
Rollback keeps the tool unavailable rather than restoring floating installation.

## Current implementation and release hold

The first five pure contracts and eleven detecting mutations qualified on the
preserved provisional source. The current source adds authenticated payload-only
content manifest df3e4f8a21794cba8e6f1315d3bd3a4bc20ffa7a81df39fe48e613e5926c1759,
its digest-pinned runtime manifest, internal trusted-source validation and owned
child lifecycle. No target server has run; new tests have not yet executed.
Repository launcher/manifests are trusted reviewed source, not a defense against
an actor already authorized to rewrite that source. The disposable payload is
not installed into the real user's fixed tool slot.

Adding the necessary root test alias triggers the existing Auto-tag workflow.
Main merge is held until the independently identified fail-open release
lookup path is safely resolved under its required design approval. Reviewed draft
publication may proceed only when separately granted after normal hooks/review
and verification that sensitive automatic PR actions are disabled. Do not evade
test routing to avoid this trigger. Existing release/deployment/install holds
remain in force.

Filesystem package lacks its own LICENSE/NOTICE. The disposable qualification
retains upstream mixed historical MIT/new Apache policy and immutable source
references; no per-contribution map or blanket legal clearance is claimed.
The SDK and all other packages retain their actual license texts; Node retains
its composite LICENSE and README. No binary/package vendor bundle is committed.

Child supervision forwards TERM/INT/HUP to its exact ChildProcess and escalates
to KILL after two seconds while still alive. Successful reaping must be observed
in real owned-process tests. An uninterruptible OS process is not promised to
terminate universally; outer qualification supervisors remain independently
bounded. There is no detached daemon or automatic restart/install fallback.

## Exact dependency gate

The newly added nested lock introduces the actual bin field
`@modelcontextprotocol/server-filesystem` → `mcp-server-filesystem` →
`dist/index.js`. This is a new executable surface versus the absent base lock;
`install-scripts-reviewed` remains human-only. No label is applied here, and
runtime-isolation design consent does not substitute for that gate. Release-age
exceptions require the delegated technical assessment after full testing.

Current local process/wire packets are prepared only, not executed. The first
wire smoke will compare repository package/lock/content-manifest trust against
the copied authenticated payload before any target execution. Mandatory-pair
promotion needs a genuine deletion-of-both-files detecting proof; existing
optional-reservation proof does not cover this changed requirement.
