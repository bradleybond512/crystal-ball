# UX-025 baseline evidence

Date: `2026-08-31`

Branch: `codex/ux-025-smoked-liquid-glass`

Canonical base: `702dc5b0521f49542d1c6cb73238841006b9a793`

Machine context:

- macOS `26.5.2` (`25F84`)
- Node.js `v26.3.0`
- npm `11.16.0`
- Crystal Ball `2.25.147`

The repository declares Node.js `>=22.0.0 <23.0.0`. The available local Node
runtime is newer, so `npm ci` emitted an engine warning. The commands below
still completed successfully; the supported Node 22 lane remains authoritative
for final CI sign-off.

## Roadmap and source baseline

```text
$ npm run test:roadmap-controller
ℙ pass 22
ℙ fail 0

$ npm run lint:md
[lint:md] Checked 130 Markdown file(s).

$ git diff --check
<no output>
```

Focused Home discovery previously recorded on canonical `macos/main` at
`ace93818` produced `112 pass / 0 fail`. The existing live-provider
`home-shell-boot.spec.ts` produced `1 pass / 4 fail`: its first external request
terminated Vite with `UND_ERR_SOCKET`, and the remaining cases received
`ERR_CONNECTION_REFUSED`. That network-coupled suite is discovery evidence, not
a UX-025 visual gate. Task 1 replaces it for this scope with a deterministic
fixture that blocks external requests.

## Backdrop-filter inventory

The declared target-file inventory contains 95 `backdrop-filter` occurrences:
38 prefixed and 57 unprefixed declarations.

| File | Prefixed | Unprefixed |
| --- | ---: | ---: |
| `src/styles/window-chrome.css` | 1 | 1 |
| `src/styles/home-shell.css` | 4 | 4 |
| `src/styles/macos-native.css` | 10 | 10 |
| `src/styles/main.css` | 18 | 32 |
| `src/styles/library.css` | 1 | 1 |
| `src/styles/alerts.css` | 3 | 8 |
| `src/components/CommandPalettePanel.ts` | 1 | 1 |

Inventory command:

```bash
rg -n "backdrop-filter" \
  src/styles/window-chrome.css \
  src/styles/home-shell.css \
  src/styles/macos-native.css \
  src/styles/main.css \
  src/styles/library.css \
  src/styles/alerts.css \
  src/components/CommandPalettePanel.ts
```

UX-025 consolidates only the reachable Full dark desktop surfaces named in the
plan. It deliberately excludes Tech, Finance, Happy, God's Vision, EEW, crisis
triage, attention navigation, and diagnostic or inline map HUDs. Shared
material, semantic, variant, and map-color tokens remain unchanged so those
specialist modes retain their current contracts.

## Build and bundle baseline

The first `npm run build:full` attempt failed after TypeScript and Vite
transformation because this new worktree had no local Cesium package. Module
resolution had climbed into the parent checkout, but the Cesium asset plugin
correctly searched the worktree and reported its missing `Workers` directory.
Running the lockfile-defined `npm ci` installed 972 packages with `0`
vulnerabilities. The same build then passed without source changes:

```text
$ npm run build:full
✓ 5633 modules transformed.
✓ built in 14.17s
PWA v1.3.0
precache 453 entries (21567.60 KiB)

$ npm run bundle:check
chunks: 107
total:  4.91 MB / 6.00 MB
✓ All bundle-size policies satisfied.
```

Generated CSS baseline:

| Asset | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| `cesium-B9DDZdqH.css` | 24,010 | 5,369 |
| `main-Ba460KWG.css` | 497,853 | 84,255 |
| `main-DmqtZZIV.css` | 550,676 | 93,513 |
| `maplibre-B2k4QVOw.css` | 69,808 | 10,073 |
| `settings-CB_ETP6Q.css` | 18,188 | 3,892 |
| **Total** | **1,160,535** | **197,102** |

Packaged CPU and memory were not captured because installing or relaunching the
desktop app has not been authorized. Task 5 keeps that checkpoint separately
gated.
