# Security Notes

## CSP unsafe-eval Exception

The desktop CSP in `src-tauri/tauri.conf.json` includes `'unsafe-eval'` in the `script-src` directive. This is required by Cesium Ion for dynamic WebGL shader compilation when rendering the God's Eye 3D globe visualization. Removing `unsafe-eval` would require replacing the Cesium library with an alternative globe implementation.

See SEC-002 in `docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md` for the full security posture assessment.
