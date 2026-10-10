# R4-SEC-004 validation: MCP output framed as untrusted, read-only by default

Historical report dated October 3, 2026 on branch `claude/r4-sec-004-mcp-untrusted`, which
is based on `main` (`a255546ee`). Approved design:
[plan](../plans/2026-10-02-r4-sec-004-mcp-untrusted.md). Bradley's choices:

- A: implement as designed.
- B: keep the repo `.mcp.json`; it sets no profile, so it is read-only.
- C: his own clients are read-only by default and opt in per config.
- D: agent feedback waits for his confirmation in the Analyst HUD.

**October 10 evidence status: UNATTESTED historical execution claims.** The
counts, safety claims, hashes and mutation outcomes below were inherited from
the original commit. Their raw execution logs were not available at intake;
they are not fresh results for the repaired integration. The separate fresh
October 10 execution section below records actual repaired-source results and
qualified proof carry. Independent final reviews remain pending.

October 10 installer qualification found that global npm resolution ignores
the package-root overrides: SDK 1.29.0 requests node-server 1.x while the
unchanged security lock selects 2.0.12. The bounded correction uses a genuine
packed project plus the unchanged lock and locked `ci`, with explicit
`--ignore-scripts` on both operations. Archive, graph, bin and alias checks
precede owned promotion/rollback. Exact-lock tarball admission and explicit
installed-child guards support isolated offline tests. Installer behavior,
fresh smoke results and new mutation proofs are recorded separately below.
Final SHA review and publication gates remain pending.

## Fresh October 10 execution

Private code freeze: `96c390f4f426979b7479f748dc2c50a0853d551c`; routing freeze:
`b0da25a7751cfbf041e8f1bdc03deac892de177b` / tree
`52b0991212d3209dac2ad065f622be4f1630cc8d`. Both commits used ordinary hooks.
Original Claude handoff `c539c3db1d4765414e0b533238a3bb2f75b043ef` was preserved.

Actual results at the initial code freeze: full MCP suite **268 pass / 0 fail /
0 skipped**, installer/isolation fixtures **12 pass / 0 fail**, tracked installer
policy **11 pass / 0 fail**, and normal-hook sidecar suite **646 pass / 0 fail**.
The genuine offline smoke installs the unchanged 93-node lock graph from 92
actual SHA512 tarball bodies into an owned temporary prefix, checks all four
aliases and security override versions, runs doctor and real default-read stdio,
and disables monitoring. It does not install the desktop app or use a user prefix.

The unchanged trusted selector at the routing freeze reports **48 changed files
and 62 selected scripts**, including all three new plain `node --test` entry
commands, with zero new coverage gaps. Selector listing is selection evidence;
the complete CI matrix still has to execute before closeout.

Actual seven-script `agentic-validate.sh` execution at the routing freeze exited
**0**. Its exact named scripts were `test:mcp-untrusted test:mcp-companion
 test:mcp-install-smoke test:mcp-deps test:mcp-storage
 test:mcp-evaluation-report test:mcp-intel` (one space between names). It ran
the unchanged lockfile/lint/typecheck/secrets/cross-agent/docs/roadmap/build
checks. Inner untrusted stages: **24 pass / 0 fail** and **23 pass / 0 fail**;
inner companion: **49 pass / 0 fail**; installed smoke: **1 pass / 0 fail**.
The companion entry also ran nine result-oracle unit tests. Outer wrapper counts
are orchestration counts and are not added to inner counts. Adjacent suites:
MCP dependencies **19/0**, storage **7/0**, evaluation reports **31/0**, intel
**23/0**. Suites overlap; no aggregate unique-test count is asserted.

### Applied proof evidence and carry limits

Root independently checked all applied diffs, before/applied hashes, actual TAP
counts and named `ERR_ASSERTION` logs, and all-file clean restoration snapshots.
At the initial freeze there are **78 accepted named-red variants**, including
every original M01–M51 obligation, help/wording/isolation/installer variants and
explicit coupled alternatives. Four singular survivors remain **survivors**:
H04, H05, H06 and I-CACHE-SRI. Other intact path checks and genuine cacache
integrity enforcement explain those outcomes; they are not credited as kills.
I-INSTALLED-CHILD guard inversion was not executed because the independent
egress guard is immutable. Its negative baseline ran, but is not a mutation proof.

Original-protocol packaging M24 fails after genuine `ci` at
`validateInstalledGraph` for missing packaged `framing.mjs`, before promotion,
doctor or stdio. M19 and M45 use bounded private oracles invoking the actual
sanitizer and HUD renderer. Prior SIGKILL, TypeError, JSON parsing, cache setup
and TAP-name parsing attempts are retained separately and not claimed as reds.

These 78 variants executed at `96c390f4`, not at a later SHA. Their production
and test targets remain byte-identical at the routing freeze. All 5,039 original
paths except the two routing JSON files were unchanged; the package fields and
inner test argument lists used by those proofs were preserved. This is explicit
content-qualified carry, not a claim of fresh proof execution at `b0da25a7`.

Routing result validation separately has **24 applied variants: 21 named-red
variants and three survivors**. Original unit baselines/restores are **9/0**.
Four private parser variants run **6/0 → 5/1 → 6/0** for missing header, trailing
summary and malformed duration, and **6/0 → 3/3 → 6/0** for coupled truncation.
R-HEADER, R-FINALSUMMARY and R-DURATION remain singular survivors. Signal,
inherited-identifier and combined summary variants concern expected rejection
diagnostics while other guards still reject; this is stated rather than claimed
as arbitrary-code acceptance. These synthetic finite TAP fixtures exercise
result validation only. They are not installed-package success evidence and do
not attest the actual timeout/process-cleanup paths. All 5,044 files restored.

### Resource provenance and safety

Genuine npm tarball bodies were authenticated against the committed lock and
admitted into test caches by explicit digest only. No real cache index, user
configuration, credentials, ignored `.env` files or user data were copied.
The earlier finite registry projection normalized one retained bin path:
`which@2.0.2` changed `./bin/node-which` to `bin/node-which` because npm
pick-manifest touched a shared object. Its historical exact-object claim is
qualified; no normalization exception was granted. The I-OVERRIDE proof instead
reconstructs all 91 packuments from preserved raw records, deep-copies the 92
retained version objects, and records new metadata hashes. The fresh owned
274-entry view has 182 metadata/Accept entries and 92 unchanged tarball bodies.
Actual locked-ci baseline **1/0**, applied legacy-global inverse **0/1** with
`ETARGET @hono/node-server@^1.19.9` plus a named install-status assertion, and
restored locked-ci **1/0** were verified. This is a finite exact-graph registry
view, not an unrestricted live registry claim. Initial strict admission failure
is preserved; the source registry cache was not overwritten.

All runtime work used fake HOME/TMP/XDG/data/resources, offline npm, explicit
owned Node guards and disposable prefixes/DOM. The JS loopback guard covers
the exercised Node HTTP/fetch paths; it is not an OS sandbox or universal
network interception. No live providers, credentials, native app, production
stores, monitor service or user prefix were used. Supported Sol launch/config
controls are evidence of requested models, not signed runtime identity.

Private audit artifact hashes: initial proof audit
`370faf5375edb2d723903d0252fc8a3d9981c37d34da8d7c5ac7181d0e2c9499`;
routing proof audit
`4949b05cc7490b48a80f2820782c0d25c80aa9625b8258e15e9256e065010e12`.
Raw logs, applied diffs, full restoration manifests and executable/resource
provenance are retained in the private October 10 evidence workspace.

### Initial-freeze named-red matrix

Each row restores the same target SHA256 as its baseline; full 5,039-file
clean restoration was independently checked. B/R/S denote pass/fail counts.

| ID | Mutated file | B → R → S | Restored SHA256 |
| --- | --- | --- | --- |
| H01 | `tools/mcp-server/tools/help.mjs` | 14/0 → 13/1 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H02 | `tools/mcp-server/tools/help.mjs` | 14/0 → 12/2 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H03 | `tools/mcp-server/tools/help.mjs` | 14/0 → 13/1 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H04A | `tools/mcp-server/tools/help.mjs` | 14/0 → 12/2 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H05A | `tools/mcp-server/tools/help.mjs` | 14/0 → 13/1 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H06A | `tools/mcp-server/tools/help.mjs` | 14/0 → 13/1 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H07 | `tools/mcp-server/tools/help.mjs` | 14/0 → 9/5 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H08 | `tools/mcp-server/tools/help.mjs` | 14/0 → 9/5 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| H08A | `tools/mcp-server/tools/help.mjs` | 14/0 → 13/1 → 14/0 | `aabc8a78956f0f6957ca92fc6333fa36d5c02bd6347b89df1568c78acacfd2c0` |
| I-ALIAS | `scripts/install-crystalball-mcp.mjs` | 5/0 → 4/1 → 5/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-CACHE-GRAPH | `tests/helpers/mcp-locked-cache.mjs` | 7/0 → 6/1 → 7/0 | `152b62820a9c41d28ea179ff3eaab732786e59bafbbbd7e16fbdcc453606ce1e` |
| I-INSTALLED-READ | `tools/mcp-server/profile.mjs` | 1/0 → 0/1 → 1/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| I-LOCK | `scripts/install-crystalball-mcp.mjs` | 1/0 → 0/1 → 1/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-MONITOR | `scripts/install-crystalball-mcp.mjs` | 1/0 → 0/1 → 1/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-OVERRIDE | `scripts/install-crystalball-mcp.mjs` | 1/0 → 0/1 → 1/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-ROLLBACK | `scripts/install-crystalball-mcp.mjs` | 5/0 → 4/1 → 5/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-SCRIPTS-CI | `scripts/install-crystalball-mcp.mjs` | 11/0 → 10/1 → 11/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I-SCRIPTS-PACK | `scripts/install-crystalball-mcp.mjs` | 11/0 → 10/1 → 11/0 | `88c34443a9eb9fa5aac2e15202a1a4051e6113989497b067503b1f3908a7772c` |
| I01 | `tests/helpers/mcp-runtime-fixture.mjs` | 7/0 → 6/1 → 7/0 | `ad6270ebf6cc9daaa348235cd7b8d4aa748f8d12b6f13e425f463e0e9f12d079` |
| I02 | `tests/helpers/mcp-runtime-fixture.mjs` | 7/0 → 6/1 → 7/0 | `ad6270ebf6cc9daaa348235cd7b8d4aa748f8d12b6f13e425f463e0e9f12d079` |
| I03 | `tests/helpers/mcp-runtime-fixture.mjs` | 7/0 → 6/1 → 7/0 | `ad6270ebf6cc9daaa348235cd7b8d4aa748f8d12b6f13e425f463e0e9f12d079` |
| M01 | `tools/mcp-server/profile.mjs` | 6/0 → 5/1 → 6/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| M02 | `tools/mcp-server/profile.mjs` | 6/0 → 3/3 → 6/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| M03 | `tools/mcp-server/profile.mjs` | 6/0 → 5/1 → 6/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| M04 | `tools/mcp-server/profile.mjs` | 6/0 → 5/1 → 6/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| M05 | `tools/mcp-server/index.mjs` | 3/0 → 1/2 → 3/0 | `1b2fa1e66bb059a9289e2c03f4562c20e5c80e5dfc8a48896d1c7ea48a3f5480` |
| M06 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M07 | `tools/mcp-server/framing.mjs` | 9/0 → 7/2 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M08 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M09 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M10 | `tools/mcp-server/framing.mjs` | 9/0 → 3/6 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M11 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M12 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M13 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M14 | `tools/mcp-server/framing.mjs` | 9/0 → 7/2 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M15 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M16 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M17 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M18 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M19 | `tools/mcp-server/framing.mjs` | 1/0 → 0/1 → 1/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M20 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M21 | `tools/mcp-server/framing.mjs` | 9/0 → 7/2 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M22 | `tools/mcp-server/framing.mjs` | 9/0 → 8/1 → 9/0 | `84b5f90c7876ca4103732f9d15f8d15df8203703f0596c65a7d10c8d786ecc27` |
| M23 | `tools/mcp-server/profile.mjs` | 6/0 → 5/1 → 6/0 | `c13dab48bbbc2180c8d72c4e98fa37bf1ccabedd57160feaa62246297abe50b3` |
| M24 | `tools/mcp-server/package.json` | 1/0 → 0/1 → 1/0 | `56a7c19d1eda30c1e5ee4a01b3ff7d76b3b77a02a0c240666a666be6531d296b` |
| M25 | `src-tauri/sidecar/local-api-server.mjs` | 3/0 → 2/1 → 3/0 | `0c2d7eff68efba29926c0a891216ce9be0619e6ed67d5774abc3cc034ec39109` |
| M26 | `src-tauri/sidecar/local-api-server.mjs` | 3/0 → 2/1 → 3/0 | `0c2d7eff68efba29926c0a891216ce9be0619e6ed67d5774abc3cc034ec39109` |
| M27 | `src-tauri/sidecar/local-api-server.mjs` | 3/0 → 2/1 → 3/0 | `0c2d7eff68efba29926c0a891216ce9be0619e6ed67d5774abc3cc034ec39109` |
| M28 | `src/services/analyst-command-listener.ts` | 10/0 → 4/6 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M29 | `src/services/analyst-command-listener.ts` | 10/0 → 8/2 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M30 | `src/services/analyst-command-listener.ts` | 10/0 → 6/4 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M31 | `src/services/analyst-command-listener.ts` | 10/0 → 9/1 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M32 | `src/services/analyst-command-listener.ts` | 10/0 → 8/2 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M33 | `src/services/analyst-command-listener.ts` | 10/0 → 8/2 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M34 | `src/services/analyst-command-listener.ts` | 10/0 → 9/1 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M35 | `src/services/analyst-command-listener.ts` | 10/0 → 8/2 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| M36 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M37 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M38 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M39 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M40 | `src/services/agent-suggestions.ts` | 9/0 → 7/2 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M41 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M42 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M43 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M44 | `src/services/agent-suggestions.ts` | 9/0 → 8/1 → 9/0 | `83bd8c47ec7537dba611f783da1f4a8f8e751de9a3ed816c6a0a5cd35652573d` |
| M45 | `src/components/agent-suggestions-view.ts` | 1/0 → 0/1 → 1/0 | `2224576f00fcbcf3e08afb73b3b2879043b05a571da891a51d5c47879d89db58` |
| M46 | `src/components/agent-suggestions-view.ts` | 5/0 → 4/1 → 5/0 | `2224576f00fcbcf3e08afb73b3b2879043b05a571da891a51d5c47879d89db58` |
| M47 | `src/components/AnalystHUD.ts` | 5/0 → 4/1 → 5/0 | `85fa0070d0bd101248a1311fb5459f1c1f91e4634ce7a68c42e89c33a428b1e5` |
| M48 | `src/components/AnalystHUD.ts` | 5/0 → 3/2 → 5/0 | `85fa0070d0bd101248a1311fb5459f1c1f91e4634ce7a68c42e89c33a428b1e5` |
| M49 | `src/components/AnalystHUD.ts` | 5/0 → 3/2 → 5/0 | `85fa0070d0bd101248a1311fb5459f1c1f91e4634ce7a68c42e89c33a428b1e5` |
| M50 | `src/services/hypothesis-feedback.ts` | 11/0 → 9/2 → 11/0 | `74010ab1244e1b281d3ed1fc2e0b7db1cede187e00c575a667aa603d709d61d9` |
| M51 | `src/services/analyst-command-listener.ts` | 10/0 → 9/1 → 10/0 | `1250703f1e71c86b327b70ffed6b9d874d559cec5baa2cb2e07aac9181a04d9c` |
| W01 | `tools/mcp-server/tools/analyst.mjs` | 15/0 → 13/2 → 15/0 | `f1c54905635e403034c13ac1aca4897d730e592220b39fb7fd290dc150ae9e9b` |
| W02 | `tools/mcp-server/tools/analyst.mjs` | 15/0 → 13/2 → 15/0 | `f1c54905635e403034c13ac1aca4897d730e592220b39fb7fd290dc150ae9e9b` |
| W03 | `tools/mcp-server/tools/analyst.mjs` | 2/0 → 1/1 → 2/0 | `f1c54905635e403034c13ac1aca4897d730e592220b39fb7fd290dc150ae9e9b` |
| W04 | `tools/mcp-server/tools/analyst.mjs` | 2/0 → 1/1 → 2/0 | `f1c54905635e403034c13ac1aca4897d730e592220b39fb7fd290dc150ae9e9b` |
| W05 | `tools/mcp-server/tool-registry.mjs` | 2/0 → 1/1 → 2/0 | `01f979efbcb076f25a7e83ded2184fa724f805b24d155f77d5f19361a4c21ab6` |
| W06 | `tools/mcp-server/tool-registry.mjs` | 2/0 → 1/1 → 2/0 | `01f979efbcb076f25a7e83ded2184fa724f805b24d155f77d5f19361a4c21ab6` |

## Behavior

- **Profiles** (`tools/mcp-server/profile.mjs`):
  - `CRYSTALBALL_MCP_PROFILE` unset, `read`, or any unknown value gives the
    **read** profile: 53 tools, all marked `readOnlyHint: true`. An unknown
    value logs one line to stderr.
  - `analyst` (case and spaces ignored) registers all 61 tools.
  - A withheld tool is never registered, so a client can neither list nor
    call it.
- **Framing** (`tools/mcp-server/framing.mjs`, wired once in `registerTool`):
  - Every string and object key is cleaned of characters a reader cannot
    see: Unicode `Cc`, `Cf` and `Cs` (zero-width, bidi marks, embeddings,
    overrides and isolates, the BOM, the Unicode tag block used for "ASCII
    smuggling"), both variation-selector blocks, Hangul fillers and similar.
    `\n` and `\t` are kept, and CR, CRLF, NEL, U+2028 and U+2029 become `\n`.
  - The copy follows JSON rules. It is bounded to 32 levels and 250,000
    object visits, and cycles are cut. Scalars and strings do not consume
    that counter, and remaining object positions each emit a marker; this
    is not a serialized-byte or element cap. Keys that collide after cleaning are all kept
    (`name~2`), and `__proto__` stays an own key.
  - Every result except `help` becomes
    `{ notice, source: "crystal-ball:<tool>", retrieved_at, untrusted_external_data }`,
    in both the text content and `structuredContent.result`. A thrown error
    becomes an `isError` result in the same frame, cleaned and capped at
    2,000 characters.
  - The server instructions name the profile and its tool count, say that
    all output is untrusted data, never instructions, and list the withheld
    tools with the setting that enables them.
- **Sidecar:** every command queued on `/api/analyst-commands` gets
  `origin: 'external'`, whatever the caller sends. `hypothesisId` is capped
  at 128 characters and `signature` at 512.
- **Renderer:**
  - The command listener validates each drained command.
  - `run_skeptic` still applies at once.
  - `thumbs_up`, `thumbs_down` and `dismiss` become pending suggestions
    (`src/services/agent-suggestions.ts`), whatever `origin` says. They are
    keyed by the matched hypothesis's signature, capped at 50, expire after
    7 days, and are validated when loaded from storage. A newer suggestion of
    the same kind for the same hypothesis replaces the older one.
- **Analyst HUD:** an **Agent suggestions (N)** section appears while any are
  pending:
  - Each row shows what will happen, the hypothesis statement, the agent's
    note labelled "unverified", and its age. All of it is set with
    `textContent`.
  - **Confirm** records the vote or the 24-hour dismissal by signature, so it
    still works after the hypothesis leaves the snapshot. **Discard** drops
    the suggestion. Each applies at most once.
  - The buttons go through the HUD's delegated root listener, so a
    background re-render cannot make them dead.
- **Docs:** `docs/AGENT_ACCESS.md` explains the profiles, the envelope and the
  HUD confirmation.

### Stricter than the plan

The plan put the envelope on tools marked `openWorldHint` only. Several
tools marked local relay renderer state that holds feed-derived text:
`get_reasoning_debug_log`, `get_pipeline_trace`, the monitor and the weekly
reports. So every tool except `help` is enveloped; `help` uses the built-in
catalog/index and checked regular packaged resources and is only cleaned.
The October 10 loader requires own membership and an ASCII slug before any
lookup, canonicalizes the package root, rejects docs/category/file symlinks,
and checks containment/direct parents before reading the canonical filename.
Install ancestor symlinks remain supported; missing/malformed/rejected docs
retain fallback/warnings. Sanitized reflected request identifiers also appear
in help. This assumes intact installed code/resources, not a hostile local
filesystem race. Instructions and notices guide clients; they are not runtime
authorization or evidence of prompt-injection immunity.

### Historical testing narrative (UNATTESTED)

- **The poll cursor.** The first mutation run left M35 (the listener's
  `issuedAt` check removed) alive: the suggestion store's own check dropped
  the malformed feedback anyway. But a bad timestamp would still reach
  `lastSeenAt = Math.max(...)` and make it `NaN`. The next poll would ask for
  `since=NaN`, which matches nothing, while the sidecar drains its queue, so
  every later command would be lost. The test now also sends a malformed
  `run_skeptic`, and M35 goes red.
- **Real coverage.** With a fake sidecar, 21 of the 61 tools carried the
  injected feed text through to their results, so the cleaning applies to
  real paths, not only to the unit fixtures.

### Not changed here

- `help` in the read profile still documents the 8 withheld tools. The
  server instructions say which tools are missing and how to enable them.
- The background monitor (`CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES`) still
  runs its local cycle under either profile. It is configured by the user,
  not called by an agent.
- The HUD shows pending suggestions only when it is open. There is no badge
  while it is closed.

## Historical validation claims (UNATTESTED)

The historical report claimed all tests used fakes: a throwaway `HOME`, a fake sidecar on `127.0.0.1:0`
with a fake token, happy-dom and in-memory storage. No real Crystal Ball
data, token or Keychain entry is touched.

| Suite | Result |
|---|---|
| `test:mcp-untrusted` (new): MCP unit 15, MCP stdio 5, sidecar 3, store 9, listener 7, HUD 5 | 44/44 |
| `tools/mcp-server` `npm test` (all MCP tests, including the install smoke test) | 251/251 |
| Sidecar `local-api-server` + `analyst-diagnostics-mirror` | 177/177 |
| `hypothesis-feedback` + `hypothesis-feedback-mult` | 7/7 + 4/4 |
| Existing Analyst HUD suites (action delegation, visibility, control delegation) | 2/2 + 4/4 + 9/9 |

- `tsc --noEmit` and ESLint are clean on every changed file. `lint:colors`
  shows no increase; the new CSS uses tokens only.
- `mcp:docs:check` passes: the generated registry did not change.

## Historical mutation summary (UNATTESTED)

The historical report claimed each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green. "MCP unit" is `profile` + `framing`;
"MCP stdio" is `untrusted-framing-stdio` + `stdio-integration`; "MCP package"
is `tool-registry` + `install-smoke`.

| # | Mutation | File (sha before) | Red suite(s), failing tests |
|---|---|---|---|
| M01 | unknown profile widens | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1), MCP stdio (1) |
| M02 | read profile admits write tools | `profile.mjs` (`c13dab48bbbc`) | MCP unit (3), MCP stdio (3) |
| M03 | prototype names count as tools | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1) |
| M04 | profile value not normalized | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1) |
| M05 | registration ignores profile | `index.mjs` (`1b2fa1e66bb0`) | MCP stdio (3) |
| M06 | handler output bypasses framing | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M07 | envelope without sanitizing | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2), MCP stdio (1) |
| M08 | get_ tools skip the envelope | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M09 | local tool trusted | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M10 | format characters kept | `framing.mjs` (`7d26ad558ab4`) | MCP unit (6), MCP stdio (1) |
| M11 | variation selectors kept | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M12 | line breaks not normalized | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M13 | newlines and tabs stripped | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M14 | keys not sanitized | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2), MCP stdio (1) |
| M15 | colliding key overwrites | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M16 | __proto__ assigned | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M17 | depth unbounded | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M18 | node budget off by one | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M19 | cycles not detected | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M20 | error text unbounded | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M21 | error text raw | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2) |
| M22 | thrown errors unframed | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M23 | instructions drop the security line | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1), MCP stdio (1) |
| M24 | new module not packaged | `package.json` (`56a7c19d1eda`) | MCP package (2) |
| M25 | caller sets origin | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M26 | hypothesisId unbounded | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M27 | signature unbounded | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M28 | agent thumbs-up applies directly | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (4) |
| M29 | non-external origin skips confirmation | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M30 | agent dismissal applies directly | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (2) |
| M31 | confirmed thumbs-down votes up | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M32 | confirmed dismissal ignored | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M33 | discard applies | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1), HUD (1) |
| M34 | skeptic held for confirmation | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M35 | issuedAt not validated | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M36 | confirm can repeat | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1), command listener (1) |
| M37 | list not capped | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M38 | suggestions never expire | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M39 | duplicates kept | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1), command listener (1) |
| M40 | hidden characters kept in agent text | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (2) |
| M41 | note not capped | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M42 | storage not validated | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M43 | oversized signature accepted | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M44 | expired suggestion can be taken | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M45 | view renders markup | `agent-suggestions-view.ts` (`2224576f00fc`) | HUD (1) |
| M46 | note not labelled unverified | `agent-suggestions-view.ts` (`2224576f00fc`) | HUD (1) |
| M47 | HUD Confirm discards | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (1) |
| M48 | HUD hides pending suggestions | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (2) |
| M49 | HUD buttons not delegated | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (2) |
| M50 | vote direction swapped | `hypothesis-feedback.ts` (`74010ab1244e`) | hypothesis-feedback (2), command listener (2) |
| M51 | dismissal stamped stale | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |

The historical report claimed all 51 mutations went red. M35 survived the first run; the listener test was
strengthened (see "Found while testing"), and the rerun went red.

## Rollback

Revert the commit. All 61 tools would be registered for every client again,
including the coding agents this repo's `.mcp.json` starts, feed text would
reach them unframed, and agent feedback would apply to calibration directly.
