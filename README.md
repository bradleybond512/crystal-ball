# Crystal Ball

A desktop situational-awareness app built on Tauri 2 + TypeScript + Vite.

## Install

Download the latest `.app` from Releases and copy it to `~/Applications/Crystal Ball.app`.

## Develop

```bash
npm install
npm run dev                  # vite dev server (web only)
npm run typecheck:all        # type-check both tsconfig.json and tsconfig.api.json
npm run desktop:build:full   # full production desktop build
```

The built app lands at `src-tauri/target/release/bundle/macos/Crystal Ball.app`.

## License

AGPL-3.0. See `LICENSE` and `NOTICE.md`.
