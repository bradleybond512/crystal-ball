# UX-074 — desktop payload inventory checkpoint

**Documentation only; shipped component coverage is unverified.** This checkpoint
records source declarations at `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`, following
the [approved design](../plans/2026-11-27-ux074-sbom-payload-design.md) and
[draft #1927](https://github.com/bradleybond512/crystal-ball/pull/1927). No desktop
build, artifact download/inspection, generator adoption or installed-app access
was performed. Full UX-074 remains open.

## Fifteen potential combinations

The [variant input](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L17) selects one of
three variants; the [target matrix](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L113)
has five entries. These are fifteen potential combinations **across invocations**,
not fifteen jobs in one run. The target column uses `node_target`; Windows and
Linux x64 Tauri calls omit `--target` and use the runner default. Variant/configuration reaches the
[Tauri build](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L300). Declared formats
come from [bundle targets](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L21); their existence,
contents and component coverage have not been measured here.

| Variant | Platform / architecture | Declared Node target | Declared package family | Artifact / SBOM coverage |
| --- | --- | --- | --- | --- |
| full | macOS ARM64 | `aarch64-apple-darwin` | app / DMG | Unverified |
| full | macOS x64 | `x86_64-apple-darwin` | app / DMG | Unverified |
| full | Windows x64 | `x86_64-pc-windows-msvc` | NSIS executable / MSI | Unverified |
| full | Linux x64 | `x86_64-unknown-linux-gnu` | AppImage | Unverified |
| full | Linux ARM64 | `aarch64-unknown-linux-gnu` | AppImage | Unverified |
| tech | macOS ARM64 | `aarch64-apple-darwin` | app / DMG | Unverified |
| tech | macOS x64 | `x86_64-apple-darwin` | app / DMG | Unverified |
| tech | Windows x64 | `x86_64-pc-windows-msvc` | NSIS executable / MSI | Unverified |
| tech | Linux x64 | `x86_64-unknown-linux-gnu` | AppImage | Unverified |
| tech | Linux ARM64 | `aarch64-unknown-linux-gnu` | AppImage | Unverified |
| finance | macOS ARM64 | `aarch64-apple-darwin` | app / DMG | Unverified |
| finance | macOS x64 | `x86_64-apple-darwin` | app / DMG | Unverified |
| finance | Windows x64 | `x86_64-pc-windows-msvc` | NSIS executable / MSI | Unverified |
| finance | Linux x64 | `x86_64-unknown-linux-gnu` | AppImage | Unverified |
| finance | Linux ARM64 | `aarch64-unknown-linux-gnu` | AppImage | Unverified |

The base configuration names [Crystal Ball](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L3);
the [tech](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.tech.conf.json#L3) and
[finance](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.finance.conf.json#L3) overlays name Tech Monitor and
Finance Monitor. Those source names do not prove an artifact's identity. Hosted
build-only dispatch availability also does not authorize dispatch here; the
[release hard pause](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L54) remains intact.

## Source-to-payload evidence and gaps

Paths below describe producer outputs or declared resources, not a measured
installer layout. Every row requires reconciliation for each inspected artifact;
presence in one variant/target cannot establish presence in another. Verification
owners are proposed roles for a separately authorized follow-up.

| Payload class / declared path | Producer and available source evidence | Missing artifact evidence | Verification owner |
| --- | --- | --- | --- |
| Renderer JavaScript, CSS and static assets: `dist/`, embedded through `frontendDist` | [Desktop build chain](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/package.json#L64), [frontend root](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L10) | Final embedded files and hashes; component membership after bundling/tree shaking; static assets outside package graphs | UI/build specialist |
| Copied Cesium assets: `dist/cesium/{Workers,ThirdParty,Assets,Widgets}` | [Vite copy loop](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/vite.config.ts#L794) | Actual copied files, including any WASM, provenance/licensing and relationship to the renderer; do not infer coverage from JavaScript imports alone | UI/build specialist |
| Generated API bundle: `api/[domain]/v1/[rpc].js`; other declared `api` resources | [esbuild producer](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/build-sidecar-sebuf.mjs#L18), [resource declaration](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L39) | Actual bundle membership and residual files; runtime supports `api` or `_up_/api` under the resource root ([resolver](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/src/main.rs#L3902)), so inspect rather than assume the layout | Sidecar/security specialist |
| XMPP bundle: `sidecar/s2u-xmpp.bundle.mjs` | [Bundled entry/output](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/build-sidecar-xmpp.mjs#L19), bundled by the desktop build chain | Included third-party components and licenses; resolved npm dependencies are not automatically shipped components | Sidecar/security specialist |
| Sidecar modules, package metadata, data/configuration and Little Snitch resources | Explicit [resource list](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L38), including `sidecar/*.mjs`, `sidecar/package.json`, `../data`, `../src/config`, `../tools/littlesnitch` | Final paths, executable classification, hashes, unexpected files and provenance of copied data/tools; a package manifest alone is not a runtime dependency inventory | Packaging/security specialist |
| Native application, Rust crates and linked libraries | [Cargo dependencies/features](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/Cargo.toml#L8), [native build integration](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/build.rs#L70) | Actual target/features, linked components and native libraries; distinguish statically included code, bundled libraries and external OS requirements | Tauri/native specialist |
| Linux media/framework libraries inside AppImage | [`bundleMediaFramework: true`](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/tauri.conf.json#L102) | Which media libraries and versions actually enter each architecture's image; external OS libraries stay a separate class | Linux packaging specialist |
| Bundled Node runtime: `sidecar/node/node` or `node.exe`, optional copied `LICENSE` | [Target mapping/download script](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/download-node.sh#L129), [archive checksum comparison](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/download-node.sh#L185), [binary/license placement](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/download-node.sh#L212), [release binary hash embedding](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/build.rs#L13) | Final packaged binary digest, architecture, upstream component/license evidence and relationship to the embedded verification hash; checksum code is not evidence of a particular shipped binary | Runtime/security specialist |
| Optional wgrib2: `sidecar/wgrib2/wgrib2` | [Conditional local macOS producer](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/desktop-package.mjs#L146), [host-only build/skip rules](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/vendor-wgrib2.sh#L140), [native dependency check](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/vendor-wgrib2.sh#L275) | Presence or explicit absence, final binary identity and dependencies; the hosted workflow invokes Tauri directly, not this local vendoring step. Do not assume either presence or absence in an artifact | Native/security specialist |

The [Rust build hook](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/src-tauri/build.rs#L48) runs
[duplicate-asset pruning](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/prune-tauri-dist.mjs#L37) before Tauri's
build integration. Pre-pruning `dist/` inventories therefore cannot substitute
for final payload measurements. Declared resource directories likewise do not
establish their final contents or platform locations.

Existing [release-manifest collection](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/release-manifest.mjs#L226)
records whole-asset names, sizes and SHA256 with source, variant, platform and
version; macOS assets require measured native identity. The workflow
[collects](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L398) these manifests and
[attests](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/.github/workflows/build-desktop.yml#L521) release subjects after
checking source/workflow SHA agreement. These are useful future binding inputs,
not proof of component membership. No manifest or attestation was downloaded or
verified for this checkpoint.

## Future bounded verification protocol — not executed

1. Obtain separate authorization naming a finite artifact set and exact
   variant/OS/architecture cases. Pin source SHA, build configuration, release
   identity and installer SHA256. Select explicit time, input-byte, expanded-byte,
   member-count and nesting-depth limits before inspection; no automatic increase
   or fallback to an unbounded scan.
2. Verify source/artifact association and final asset digest against authorized
   manifest/provenance evidence. Reject mismatched variant, target, source or
   hashes. Missing evidence is unavailable, not a successful verification.
3. Inspect without executing installers or embedded programs. Preflight archive
   paths, duplicate destinations, absolute/parent paths, device entries, symlinks
   and hardlinks before any extraction into an isolated destination. Unsupported
   containers or a reached limit stop that case with partial coverage. Tooling or
   mount privileges need their own approved boundary; never inspect the installed
   application or user profile as a shortcut.
4. Record actual internal path, type, size and digest for every observed payload.
   Reconcile every class above, including optional absence and unexpected files.
   Establish bundle membership and Rust/native linkage from suitable build and
   artifact evidence; record external OS requirements separately. Do not label
   unresolved files, omitted cases or a complete lockfile graph as covered.
5. Bind component evidence and relationships to those final bytes. Report format
   validation separately from coverage. Missing required payloads, unexplained
   extras, incomplete attribution or source/artifact drift prevent a completeness
   claim. Verification of a subset leaves every other matrix row unverified.

CycloneDX JSON and SPDX JSON remain candidates, not selected formats or compliance
claims. No configured generator was identified in the scoped discovery, and no
generator has been installed or evaluated here. Future adoption must establish
pinned provenance/integrity, maintenance/licensing and build impact, while retaining
dependency-age and install-script controls. No evidence shows one scanner covers
JavaScript bundles, Rust linkage and vendored binaries together. Keep scans local
and offline unless a separately approved design allows disclosure or retrieval.

## Validation, review and acceptance record

Source paths and declarations above were read; these are source-backed inventory
claims, not shipped-artifact execution results. Local validation ran under Node 22
using existing dependencies with an identical root lockfile; nothing was installed.
The initial gate stopped on Markdown MD018 because a line began with `#1920`.
Changing that prose to `PR #1920` resolved it; no check was weakened.

Actual results from `npm run test:roadmap-controller` and the final gate:

```text
# tests 135
# pass 135
# fail 0
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
Tests run: test:roadmap-controller
```

Commands: `npm run test:roadmap-controller`; `npm run typecheck:all`;
`npm run docs:check -- --changelog-advisory`;
`bash scripts/agentic-validate.sh --tests "test:roadmap-controller"`.
Each completed with exit 0 on the final run. The gate also ran the unchanged
lockfile, lint, secret, cross-agent, roadmap and ordinary web-build checks.
Existing build warnings and roadmap advisories remain in the raw logs; they
were not suppressed. This web build is not a desktop packaging operation.

The local reference/matrix check reported:

```text
32 SHA-pinned source references and 1 local design reference resolve; 15 unique potential combinations remain Unverified.
```

The complete refreshed PR snapshot selected UX-074 before its claim and reports
no further eligible unclaimed task after #1927, with zero blocking findings.
This does not mean the roadmap is complete: held, claimed and monitoring work
remains. Raw validation logs are retained in the private `next-nov27/ux074`
evidence directory; the initial Markdown failure is retained separately.
These private receipts are not publicly reproducible from the PR; their SHA256
bindings preserve which evidence was checked:

- `ux074-final-gate.log`: `393d9a370f7fa78ea31ed558a3b1a2a971c206277ae8a36c0699104e2d0888a2`
- `ux074-final-roadmap-snapshot.json`: `68261072b19950b42a5719fc7ab849a33450fc349130114af0933a672c1567d2`
- `ux074-final-roadmap-result.json`: `32cdaf17e43c5c5f9407a480cb87053ac32fc2e478219d5d307d39f58fab5644`

Preliminary claim review found zero blockers. Final independent Sol and Sonnet
review are pending at this evidence commit; the later SHA-pinned verdict and
closeout receipt must record their actual conclusions. Completion publication
and hosted acceptance are also pending. A passing documentation/build check
cannot change any shipped-coverage cell to verified.

No artificial mutation proof is claimed for prose. A future verifier must have
behavioral mutation proofs for tampered hashes, missing/extra payloads, variant
mismatch, archive escapes and incomplete attribution. Manual artifact acceptance
remains pending under the current holds.

Rollback removes this checkpoint and restores prior tracker metadata; there is no
runtime, storage or migration change. Do not run `desktop:build:full`: its
[orchestrator includes local installation](https://github.com/bradleybond512/crystal-ball/blob/ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda/scripts/desktop-build-full.mjs#L29).
Merging, auto-merge, releases, deployment, installation and cleanup stay paused;
PR #1920 retains its separate workflow. Full UX-074 is open until separately approved
artifact verification establishes the required coverage.

## Proposed commit and draft description

Commit: `docs: separate declared payloads from shipped SBOM proof`.

The documentation records fifteen potential variant/target combinations, declared
payload classes and the evidence missing from a complete SBOM. It defines bounded
future artifact inspection without adopting tools or changing runtime, packaging
or release behavior. Local roadmap, documentation, type and full validation checks
passed. Full UX-074 remains open; final review, completion publication and hosted
acceptance are separate from this source checkpoint.
