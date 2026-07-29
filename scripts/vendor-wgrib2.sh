#!/usr/bin/env bash
set -euo pipefail

# Vendors a self-contained `wgrib2` binary into src-tauri/sidecar/wgrib2/ for the
# HRRR-Smoke MASSDEN decoder (../hrrr-smoke.mjs -> /api/smoke/hrrr-grid).
#
# Unlike scripts/download-node.sh, there is no prebuilt wgrib2 distribution:
# NOAA ships source only, and Homebrew has no formula. So this BUILDS from
# source, and — critically — builds C-only and self-contained so the result
# links *only* system dylibs. Under the app's hardened runtime + library
# validation a bundled Mach-O that pulls in a Homebrew libgfortran/libomp would
# be killed at load. Point extraction (`-lon`) needs no Fortran interpolation,
# so USE_IPOLATES=0 MAKE_FTN_API=0 USE_OPENMP=0 costs us nothing and buys a
# clean binary. The otool -L gate below is a HARD fail on any non-system dep.
#
# Fail-closed by design: if this script skips or fails, the vendor slot keeps
# only its README/.gitkeep, the app still bundles, and HRRR stays inert ->
# Open-Meteo fallback. desktop-package.mjs invokes this NON-fatally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_DIR="${ROOT_DIR}/src-tauri/sidecar/wgrib2"
OUTPUT_NAME="wgrib2"

# 3.1.3 is the newest version NOAA CPC actually hosts (there is no 3.6.x tarball).
WGRIB2_VERSION="${WGRIB2_VERSION:-3.1.3}"
# NOAA CPC source mirror. Overridable because the exact hosted path can move and
# the value cannot be verified from a restricted build sandbox.
WGRIB2_URL="${WGRIB2_URL:-https://www.ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz.v${WGRIB2_VERSION}}"
# Optional: skip the network entirely by pointing at a pre-fetched source tarball.
WGRIB2_SRC_TARBALL="${WGRIB2_SRC_TARBALL:-}"
# Integrity pin — a mismatch is fatal. Defaults to the verified sha256 of the
# v3.1.3 tarball; a mismatch aborts the build. Set WGRIB2_SHA256 to override (or
# to an empty string to opt out) when pointing WGRIB2_VERSION/URL elsewhere.
if [[ -z "${WGRIB2_SHA256+set}" ]]; then
  if [[ "${WGRIB2_VERSION}" == "3.1.3" ]]; then
    WGRIB2_SHA256="b7d9f2ddc1b9a04f21c70ba3410b641d2189075f6f91520e250fcf79330f6c11"
  else
    WGRIB2_SHA256=""
  fi
fi

usage() {
  cat <<'EOF'
Usage: bash scripts/vendor-wgrib2.sh [--target <triple>]

Builds a self-contained wgrib2 for the HOST architecture (macOS only) and
installs it at src-tauri/sidecar/wgrib2/wgrib2.

Supported targets (host arch must match; wgrib2 is compiled, not cross-built):
  - aarch64-apple-darwin
  - x86_64-apple-darwin
Any non-macOS target (or a macOS target whose arch != the host) is SKIPPED with
exit 0 — the vendor slot stays empty and HRRR falls back to Open-Meteo.

Environment:
  WGRIB2_VERSION      Source version to build (default: 3.1.3)
  WGRIB2_URL          Source tarball URL (default: NOAA CPC mirror)
  WGRIB2_SRC_TARBALL  Local source tarball to use instead of downloading
  WGRIB2_SHA256       Expected sha256 of the source tarball (fatal on mismatch)
  WGRIB2_TARGET       Optional target triple (same as --target)
  RUNNER_OS           Optional GitHub Actions OS hint
  RUNNER_ARCH         Optional GitHub Actions arch hint
EOF
}

TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --target" >&2
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${TARGET}" ]]; then
  TARGET="${WGRIB2_TARGET:-}"
fi

# Resolve the host triple so we can honor an explicit --target only when it
# matches (a from-source C build compiles for the host; we do not cross-compile).
host_triple() {
  if [[ -n "${RUNNER_OS:-}" ]]; then
    case "${RUNNER_OS}" in
      macOS)
        case "${RUNNER_ARCH:-}" in
          ARM64|arm64) echo "aarch64-apple-darwin" ;;
          X64|x64)     echo "x86_64-apple-darwin" ;;
          *)           echo "unsupported" ;;
        esac
        ;;
      *) echo "non-macos" ;;
    esac
    return
  fi
  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64|aarch64) echo "aarch64-apple-darwin" ;;
        x86_64)        echo "x86_64-apple-darwin" ;;
        *)             echo "unsupported" ;;
      esac
      ;;
    *) echo "non-macos" ;;
  esac
}

HOST_TRIPLE="$(host_triple)"

if [[ -z "${TARGET}" ]]; then
  TARGET="${HOST_TRIPLE}"
fi

# Start from a clean slot: never let a stale or wrong-architecture binary from a
# previous run survive a skip or a failed build. We only (re)install at the very
# end, after the otool self-containment gate passes.
rm -f "${DEST_DIR}/${OUTPUT_NAME}"

skip() {
  echo "[vendor-wgrib2] SKIP: $1" >&2
  echo "[vendor-wgrib2] HRRR-Smoke stays inert; the app falls back to Open-Meteo." >&2
  exit 0
}

case "${TARGET}" in
  aarch64-apple-darwin|x86_64-apple-darwin) ;;
  *) skip "target '${TARGET}' is not a macOS build target" ;;
esac

if [[ "${HOST_TRIPLE}" != "aarch64-apple-darwin" && "${HOST_TRIPLE}" != "x86_64-apple-darwin" ]]; then
  skip "host is not macOS (detected '${HOST_TRIPLE}') — cannot compile wgrib2 here"
fi

if [[ "${TARGET}" != "${HOST_TRIPLE}" ]]; then
  skip "requested '${TARGET}' but host is '${HOST_TRIPLE}' — wgrib2 is compiled for the host arch, not cross-built"
fi

# No cmake: this build disables every external GRIB2 codec (see the make
# invocation below). HRRR-Smoke MASSDEN is packed with Data Representation
# Template 5.3 (complex packing + spatial differencing), a pure-integer algorithm
# implemented inside wgrib2 itself — so PNG/JPEG2000/AEC are never needed, and the
# binary links only /usr/lib/libSystem. cc + make + tar + otool suffice.
for tool in cc make tar otool; do
  command -v "${tool}" >/dev/null 2>&1 || skip "required build tool '${tool}' not found on PATH"
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

TARBALL="${TMP_DIR}/wgrib2-src.tgz"
if [[ -n "${WGRIB2_SRC_TARBALL}" ]]; then
  if [[ ! -f "${WGRIB2_SRC_TARBALL}" ]]; then
    skip "WGRIB2_SRC_TARBALL='${WGRIB2_SRC_TARBALL}' does not exist"
  fi
  echo "[vendor-wgrib2] Using local source tarball ${WGRIB2_SRC_TARBALL}"
  cp "${WGRIB2_SRC_TARBALL}" "${TARBALL}"
else
  echo "[vendor-wgrib2] Downloading wgrib2 v${WGRIB2_VERSION} source"
  echo "[vendor-wgrib2]   ${WGRIB2_URL}"
  if ! curl -fsSL "${WGRIB2_URL}" -o "${TARBALL}"; then
    skip "source download failed (network blocked or URL moved) — set WGRIB2_URL or WGRIB2_SRC_TARBALL"
  fi
fi

if [[ -n "${WGRIB2_SHA256}" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA="$(sha256sum "${TARBALL}" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA="$(shasum -a 256 "${TARBALL}" | awk '{ print $1 }')"
  else
    echo "[vendor-wgrib2] Neither sha256sum nor shasum available for checksum verification." >&2
    exit 1
  fi
  if [[ "${WGRIB2_SHA256}" != "${ACTUAL_SHA}" ]]; then
    echo "[vendor-wgrib2] Source checksum mismatch — refusing to build." >&2
    echo "  Expected: ${WGRIB2_SHA256}" >&2
    echo "  Actual:   ${ACTUAL_SHA}" >&2
    exit 1
  fi
  echo "[vendor-wgrib2] Source checksum verified."
else
  echo "[vendor-wgrib2] WARNING: no WGRIB2_SHA256 pin set — integrity relies on TLS only." >&2
fi

EXTRACT_DIR="${TMP_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"
if ! tar -xzf "${TARBALL}" -C "${EXTRACT_DIR}"; then
  skip "source tarball did not extract (not a gzip tarball?)"
fi

# NOAA source extracts to grib2/ ; locate the makefile defensively.
SRC_DIR=""
if [[ -f "${EXTRACT_DIR}/grib2/makefile" ]]; then
  SRC_DIR="${EXTRACT_DIR}/grib2"
else
  SRC_DIR="$(dirname "$(find "${EXTRACT_DIR}" -maxdepth 3 -name makefile -path '*grib2*' 2>/dev/null | head -n1)")"
fi
if [[ -z "${SRC_DIR}" || ! -f "${SRC_DIR}/makefile" ]]; then
  skip "could not find grib2/makefile in the extracted source"
fi

echo "[vendor-wgrib2] Building C-only self-contained wgrib2 in ${SRC_DIR}"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 2)"

# C-only, self-contained. Command-line assignments override the makefile's own
# `=` defaults. Everything that would pull a non-system dylib or a Fortran/cmake
# toolchain is OFF:
#   USE_IPOLATES=0 (Fortran interpolation) + its coupled USE_SPECTRAL=0,
#   MAKE_FTN_API=0 (Fortran API), USE_OPENMP=0 (libomp), USE_PROJ4=0 (libproj),
#   USE_NETCDF3/4=0 (netcdf/hdf5), USE_G2CLIB=0, USE_MYSQL=0, USE_UDF=0,
#   MAKE_SHARED_LIB=0 (one static exe, no libwgrib2.dylib), and every external
#   GRIB2 codec off — USE_PNG=0 USE_JASPER=0 USE_OPENJPEG=0 USE_AEC=0.
# Dropping the codecs also avoids compiling vintage bundled C (zlib-1.2.12,
# libpng-1.2.59) that no longer builds under a C23-default clang. MASSDEN's
# Template 5.3 packing is decoded by wgrib2's own complex_pk unpacker, so `-lon`
# point extraction still works; the result links only /usr/lib/libSystem. In the
# unlikely event NCEP re-packs HRRR with an external codec, decode fails closed
# and the app falls back to Open-Meteo.
if ! make -C "${SRC_DIR}" -j"${JOBS}" \
    CC=cc \
    USE_IPOLATES=0 \
    USE_SPECTRAL=0 \
    MAKE_FTN_API=0 \
    USE_OPENMP=0 \
    USE_NETCDF3=0 \
    USE_NETCDF4=0 \
    USE_HDF5=0 \
    USE_MYSQL=0 \
    USE_PROJ4=0 \
    USE_G2CLIB=0 \
    USE_UDF=0 \
    MAKE_SHARED_LIB=0 \
    USE_REGEX=1 \
    USE_TIGGE=1 \
    USE_PNG=0 \
    USE_JASPER=0 \
    USE_OPENJPEG=0 \
    USE_AEC=0 \
    >"${TMP_DIR}/build.log" 2>&1; then
  echo "[vendor-wgrib2] Build failed. Last 40 lines of build log:" >&2
  tail -n 40 "${TMP_DIR}/build.log" >&2
  skip "wgrib2 compilation failed (see log above)"
fi

BUILT_BIN="$(find "${SRC_DIR}" -maxdepth 3 -type f -name wgrib2 -perm -u+x 2>/dev/null | head -n1)"
if [[ -z "${BUILT_BIN}" || ! -f "${BUILT_BIN}" ]]; then
  # Fall back to the conventional location.
  if [[ -f "${SRC_DIR}/wgrib2/wgrib2" ]]; then
    BUILT_BIN="${SRC_DIR}/wgrib2/wgrib2"
  else
    skip "build reported success but no wgrib2 binary was produced"
  fi
fi

# HARD self-containment gate: every dependent dylib must be a system library.
# Anything under /opt, /usr/local, @rpath, @loader_path, etc. would be killed by
# library validation once the bundle is signed with the hardened runtime.
echo "[vendor-wgrib2] otool -L ${BUILT_BIN}"
otool -L "${BUILT_BIN}" >&2
BAD_DEPS="$(
  otool -L "${BUILT_BIN}" \
    | tail -n +2 \
    | awk '{ print $1 }' \
    | grep -v -E '^/usr/lib/' \
    | grep -v -E '^/System/Library/' \
    || true
)"
if [[ -n "${BAD_DEPS}" ]]; then
  echo "[vendor-wgrib2] REFUSING to vendor: non-system dylib dependency detected." >&2
  echo "${BAD_DEPS}" | sed 's/^/  - /' >&2
  echo "[vendor-wgrib2] Such a binary is killed by hardened-runtime library validation." >&2
  echo "[vendor-wgrib2] Rebuild with the Fortran/OpenMP features OFF (they pull these in)." >&2
  exit 1
fi

# Smoke test: confirm the binary actually runs on this host. wgrib2 prints its
# version banner to stderr but then EXITS NON-ZERO (it treats "no input file" as
# an error), so we cannot gate on the exit status — we gate on the banner text.
"${BUILT_BIN}" --version >"${TMP_DIR}/config.log" 2>&1 || true
if ! grep -qE 'v[0-9]+\.[0-9]' "${TMP_DIR}/config.log"; then
  "${BUILT_BIN}" -version >"${TMP_DIR}/config.log" 2>&1 || true
fi
if ! grep -qE 'v[0-9]+\.[0-9]' "${TMP_DIR}/config.log"; then
  echo "[vendor-wgrib2] Built binary did not print a version banner:" >&2
  tail -n 20 "${TMP_DIR}/config.log" >&2
  skip "built wgrib2 failed to run on this host"
fi

mkdir -p "${DEST_DIR}"
TMP_OUTPUT="${DEST_DIR}/${OUTPUT_NAME}.tmp"
cp "${BUILT_BIN}" "${TMP_OUTPUT}"
chmod +x "${TMP_OUTPUT}"
mv -f "${TMP_OUTPUT}" "${DEST_DIR}/${OUTPUT_NAME}"

echo "[vendor-wgrib2] Vendored self-contained wgrib2 v${WGRIB2_VERSION} for ${TARGET}"
echo "[vendor-wgrib2]   -> ${DEST_DIR}/${OUTPUT_NAME}"
