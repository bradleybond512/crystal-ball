# Crystal Ball Documentation

![Version](https://img.shields.io/github/v/release/bradleybond512/crystal-ball?label=version)

This repo is easiest to understand in layers: product surface first, runtime boundaries second, then extension points and release mechanics. The guides below are organized that way so a reviewer can move quickly from "what is this?" to "how is this built?" without digging through the whole tree.

## Fastest Way To Evaluate The Project

If you have ten minutes, read these in order:

| Read this | Why it matters |
| --- | --- |
| [../README.md](../README.md) | Product overview, architecture thesis, and repo-level capabilities |
| [GitHub Sponsors](https://github.com/sponsors/bradleybond512) | Optional support path for ongoing Crystal Ball development |
| [API_KEY_DEPLOYMENT.md](API_KEY_DEPLOYMENT.md) | Clear view of the cloud trust boundary and origin rules |
| [DESKTOP_CONFIGURATION.md](DESKTOP_CONFIGURATION.md) | Desktop secret model, runtime capabilities, and graceful degradation |
| [RELEASE_PACKAGING.md](RELEASE_PACKAGING.md) | Evidence that the desktop target is treated like a real deliverable |

## Product Snapshot

Crystal Ball currently ships:

- `4` web variants
- `3` desktop build targets (`full`, `tech`, `finance`)
- a variant-specific panel catalog (see [src/config/panels.ts](../src/config/panels.ts))
- a configurable 3D globe layer catalog (see [src/config/panels.ts](../src/config/panels.ts) `FULL_MAP_LAYERS`)
- `21` generated OpenAPI specs
- `19` locale bundles
- `68` desktop secret slots backed by the OS keychain
- `41` MCP tools for local intelligence workflows

Catalog sizes are intentionally derived from the current codebase instead of duplicated here.

## Architecture Reading Path

| Guide | Focus |
| --- | --- |
| [../README.md](../README.md) | High-level system overview and technical posture |
| [../SECURITY.md](../SECURITY.md) | Security scope, reporting path, and desktop/runtime boundaries |
| [local-backend-audit.md](local-backend-audit.md) | Desktop sidecar parity matrix and fallback behavior |
| [TAURI_VALIDATION_REPORT.md](TAURI_VALIDATION_REPORT.md) | Validation outcomes and failure classification |

## Runtime and Operations Docs

| Guide | Focus |
| --- | --- |
| [API_KEYS.md](API_KEYS.md) | All 68 API keys — categories, signup URLs, free/paid status |
| [DESKTOP_CONFIGURATION.md](DESKTOP_CONFIGURATION.md) | Desktop secret keys, feature availability, and degraded behavior |
| [API_KEY_DEPLOYMENT.md](API_KEY_DEPLOYMENT.md) | Vercel API access rules, trusted origins, and key requirements |
| [RELAY_PARAMETERS.md](RELAY_PARAMETERS.md) | Relay environment variables for AIS and OpenSky paths |
| [RELEASE_PACKAGING.md](RELEASE_PACKAGING.md) | Tauri packaging, signing, and clean-machine validation |

## Intelligence and Integration Docs

| Guide | Focus |
| --- | --- |
| [MCP_PIPELINE.md](MCP_PIPELINE.md) | How Claude Code gathers intelligence from Crystal Ball via MCP -- full pipeline, auth, tools, slash commands |
| [ALERTS_ENHANCEMENT_ROADMAP.md](ALERTS_ENHANCEMENT_ROADMAP.md) | Alert system architecture, unified inbox, correlation, and enhancement roadmap |
| [reasoning-layer.md](reasoning-layer.md) | Analyst hypothesis generation, feedback, skepticism, metrics, and explainability |
| [CSP_AUDIT.md](CSP_AUDIT.md) | Current content security posture, browser allowances, and hardening notes |

## API and Extension Docs

| Guide | Focus |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contributor workflow, verification, and repo map |
| [ADDING_ENDPOINTS.md](ADDING_ENDPOINTS.md) | How to add or extend Sebuf RPC endpoints |
| [api](api) | Generated OpenAPI specs from the live proto surface |

The generated specs under `docs/api/` are the canonical output of the current contract layer. If you change `.proto` files, regenerate them with:

```bash
make generate
```

## Research Docs

| Guide | Focus |
| --- | --- |
| [../research/README.md](../research/README.md) | Repeatable autoresearch loop and track execution |

## Support

Crystal Ball remains free and open source. Users who want to help cover ongoing development can sponsor the project through [GitHub Sponsors](https://github.com/sponsors/bradleybond512).

## Verification Commands

For docs or product-surface updates, these are the most useful baseline checks:

```bash
npm run lint:strict
npm run typecheck:all
npm run test:data
npm run test:sidecar
npm run test:e2e:runtime
```

If you touch contracts, also run:

```bash
make check
```
