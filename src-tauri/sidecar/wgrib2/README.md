# Bundled `wgrib2` slot

This directory is the bundle slot for a vendored **`wgrib2`** binary, used by the
HRRR-Smoke MASSDEN decoder (`../hrrr-smoke.mjs` → `/api/smoke/hrrr-grid`).

It mirrors the sibling `../node/` runtime slot:

- The real `wgrib2` binary is **build-generated, not committed** — `.gitignore`
  ignores everything here except `.gitkeep` and this README.
- `scripts/vendor-wgrib2.sh` populates `./wgrib2` for the current target.
- `tauri.conf.json` lists `sidecar/wgrib2` in `bundle.resources`, so whatever is
  here gets copied into the app's `Resources/sidecar/wgrib2/` and signed by the
  bundle's recursive `codesign --deep --options runtime` pass (same as `node`).
- At runtime the sidecar resolves `${LOCAL_API_RESOURCE_DIR}/sidecar/wgrib2/wgrib2`
  (see `resolveWgrib2Path` in `../hrrr-smoke.mjs`).

**If `./wgrib2` is absent** (the vendor build was skipped or failed) the app still
builds and runs — the decoder reports `available:false` and the smoke map falls
back to the Open-Meteo forecast field. No regression, no error surface.

## Populate it

```bash
bash scripts/vendor-wgrib2.sh            # host target
bash scripts/vendor-wgrib2.sh --target aarch64-apple-darwin
```

The binary is built **C-only and self-contained** (`USE_IPOLATES=0
MAKE_FTN_API=0 USE_OPENMP=0`) so it links only system dylibs — a hard
requirement under the app's hardened runtime + library validation. The script
fails loudly if `otool -L` shows any non-system dependency, because such a binary
would be killed at load time inside the signed bundle.
