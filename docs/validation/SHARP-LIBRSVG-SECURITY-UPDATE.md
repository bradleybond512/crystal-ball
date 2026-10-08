# Sharp bundled librsvg security update

Evidence date: 2026-10-08. Base: `b9122ab23e2658aa6628bae8702dde6b01a1ae61`.

## Objective and scope

Remove the high-severity Sharp/librsvg advisory from the existing
`@xenova/transformers@2.17.2` dependency path. The upstream fix is
[Sharp 0.35.5](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

The root Sharp override changes from `^0.35.3` to `^0.35.5`. The lockfile changes
only 27 Sharp/binary/libvips entries: Sharp and its binary packages become
0.35.5, and the corresponding libvips packages become 1.3.4. The dependency
names, other package entries, direct dependencies, Transformers version and
application version remain unchanged. Existing licenses remain unchanged.
This uses the existing maintained Sharp package and its official registry
artifacts; no replacement library is introduced.

npm's regeneration also normalized unrelated libc metadata and hoisted the
existing WASM runtime. Those mechanical changes were restored exactly from
main. A fresh `npm ci` accepts the resulting lockfile without changing it.

## Executed verification

The isolated worktree used Node 22.23.1 and npm 10.9.8. Dependency lifecycle
scripts remained disabled by the repository policy.

| Check | Actual result |
| --- | --- |
| Fresh `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0; 934 packages installed; lock hash unchanged |
| `npm run lockfile:check` | Exit 0 |
| Real in-memory Sharp smoke | Exit 0; Sharp 0.35.5 and bundled librsvg 2.63.2 |
| SVG decode, resize, PNG encode/decode | 8x8 SVG became 3x5 PNG; all 15 decoded RGBA pixels matched |
| `npm run test:supply-chain-gates` | 16 passed, 0 failed |
| Dependency-age gate against the base above | Exit 0; all 27 changed registry versions older than seven days |
| `npm audit --json --audit-level=high` | Exit 0; 0 high/critical, 3 low |
| `npm audit signatures` | Exit 0; 932 verified signatures and 126 verified attestations |

The actual main audit before the fix reported two high affected packages
(Sharp and Transformers through Sharp) and three low affected packages. The
fixed audit removes that high chain. The unchanged low KaTeX/micromark/markdownlint
chain requires separate compatibility work and is outside this patch.

The smoke ran on macOS arm64 using only image buffers in memory. It exercises
the loaded native SVG parser and image pipeline; it does not reproduce the
upstream exploit or establish native compatibility on other operating systems.
No model downloads or user image files were used. The renderer/worker build and
typecheck are included in the required final repository gate:

```bash
bash scripts/agentic-validate.sh --tests "test:supply-chain-gates"
```

## Completion gates

The final gate result must be attached to the frozen SHA's review evidence.
A Codex-authored branch requires independent Claude Sonnet medium review and a
genuine SHA-pinned verdict. Bradley must review the lockfile change and apply
`dependency-change-approved`; the local policy still blocks without that label.
Normal CI and repository closeout govern merge. No age exception is needed.
