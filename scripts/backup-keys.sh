#!/usr/bin/env bash
# Back up Crystal Ball's API keys from the macOS Keychain to iCloud Drive,
# encrypted. Run by Bradley only (CLAUDE.md Keychain rule); agents test this
# script against a stub `security` binary and never run it for real.
#
# The app keeps every key in ONE Keychain item: service `crystal-ball`,
# account `secrets-vault`, a JSON object of NAME -> value. This script reads
# that item into memory, validates it, and pipes it straight into the
# encryptor: the plaintext never touches disk. Only when no vault item exists
# does it fall back to the pre-vault per-key items (the names the app
# supports, read from src-tauri/src/main.rs).
#
# Encryption engine priority:
#   1. age      — ChaCha20-Poly1305 AEAD, scrypt passphrase KDF
#                 (https://age-encryption.org). brew install age.
#   2. gpg      — AES256 + SHA512 + iterated S2K + OpenPGP MDC.
#   3. openssl  — AES-256-CBC + PBKDF2-HMAC-SHA256 (600,000 iters) + a
#                 sidecar HMAC-SHA256 for integrity. The HMAC step briefly
#                 shows the passphrase in `ps`; install age or gpg to avoid it.
#
# Output: ~/Library/Mobile Documents/com~apple~CloudDocs/CrystalBall/
#         keys-backup-YYYYMMDD-{age,gpg,openssl}.enc (mode 600)
#
# Usage:
#   scripts/backup-keys.sh [--dry-run]
#
# Exit codes:
#   0  success
#   1  argument / environment / Keychain access / validation / encryption error
#   2  no keys found (nothing backed up)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_TOOL="$SCRIPT_DIR/vault-json.mjs"
MAIN_RS="$REPO_ROOT/src-tauri/src/main.rs"
SERVICE="crystal-ball"
VAULT_ACCOUNT="secrets-vault"
ERR_ITEM_NOT_FOUND=44

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (it validates the vault in memory)." >&2
  exit 1
fi

# ── Detect encryption engine ────────────────────────────────────────
ENGINE=""
if command -v age >/dev/null 2>&1; then
  ENGINE="age"
elif command -v gpg >/dev/null 2>&1; then
  ENGINE="gpg"
elif command -v openssl >/dev/null 2>&1; then
  ENGINE="openssl"
else
  echo "No encryption tool found. Install age (brew install age), gpg, or openssl." >&2
  exit 1
fi
echo "Encryption engine: $ENGINE"

ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CrystalBall"
ENC_PATH="$ICLOUD_DIR/keys-backup-$(date +%Y%m%d)-$ENGINE.enc"
if [[ ! -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]]; then
  echo "iCloud Drive is not enabled on this Mac. Aborting." >&2
  exit 1
fi

# ── Read the vault (memory only) ────────────────────────────────────
SOURCE="the secrets-vault item"
set +e
RAW="$(security find-generic-password -s "$SERVICE" -a "$VAULT_ACCOUNT" -w 2>/dev/null)"
status=$?
set -e
if (( status == ERR_ITEM_NOT_FOUND )); then
  # No consolidated vault (a pre-migration install): collect legacy items.
  SOURCE="legacy per-key items"
  echo "No secrets-vault item found; looking for legacy per-key items..."
  RAW=""
  NAMES="$(node "$VAULT_TOOL" supported-keys "$MAIN_RS")"
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    set +e
    value="$(security find-generic-password -s "$SERVICE" -a "$key" -w 2>/dev/null)"
    key_status=$?
    set -e
    # Only a missing item is skipped. Denied access or any other error fails
    # closed: an incomplete backup must never replace a complete one.
    if (( key_status == ERR_ITEM_NOT_FOUND )); then
      continue
    elif (( key_status != 0 )); then
      unset value RAW
      echo "Could not read the legacy Keychain item $key (security exit $key_status). Nothing was written." >&2
      echo "If macOS asked for access, choose Allow and run the backup again." >&2
      exit 1
    fi
    if [[ -n "$value" ]]; then
      RAW+="$key=$value"$'\n'
    fi
  done <<< "$NAMES"
  unset value
elif (( status != 0 )); then
  # Access denied or another Keychain error: never silently fall back to a
  # stale legacy subset.
  echo "Could not read the secrets-vault Keychain item (security exit $status)." >&2
  echo "If macOS asked for access, choose Allow and run the backup again." >&2
  exit 1
fi

if ! VAULT_JSON="$(printf '%s' "$RAW" | node "$VAULT_TOOL" normalize --supported "$MAIN_RS")"; then
  unset RAW
  echo "The content of $SOURCE is not a valid key vault. Nothing was written." >&2
  exit 1
fi
unset RAW

COUNT="$(printf '%s' "$VAULT_JSON" | node "$VAULT_TOOL" count)"
if (( COUNT == 0 )); then
  echo "No keys found in $SOURCE — nothing to back up." >&2
  exit 2
fi
echo "Found $COUNT keys in $SOURCE (names only, values never shown):"
printf '%s' "$VAULT_JSON" | node "$VAULT_TOOL" names | sed 's/^/  /'

if (( DRY_RUN == 1 )); then
  echo "[dry-run] Would write encrypted backup to: $ENC_PATH"
  if [[ "$ENGINE" == "openssl" ]]; then
    echo "[dry-run] Would also write HMAC sidecar to:   $ENC_PATH.hmac"
  fi
  exit 0
fi

# OpenSSL writes a pair (ciphertext + .hmac sidecar) and two renames cannot be
# atomic together. While a new pair is published, the previous pair is kept as
# hard links under PRIOR_PATH: a failure rolls it back, and a run killed
# outright leaves it there, directly restorable with restore-keys.
PRIOR_PATH="${ENC_PATH%-openssl.enc}-prior-openssl.enc"
# Only one openssl run at a time may own that publication: the run holding
# LOCK_DIR (mkdir is atomic) owns the pair, its snapshots and their rollback,
# and a run that cannot take the lock touches nothing. A lock left by a killed
# run is never taken over automatically.
LOCK_DIR="$ENC_PATH.lock"
OWN_LOCK=0

# ── Encrypt straight from memory ────────────────────────────────────
mkdir -p "$ICLOUD_DIR"
umask 077
# Encrypt to a temporary name and move it into place only on success, so a
# failed run (wrong confirmation, Ctrl-C) never clobbers today's good backup.
OUT_TMP="$ENC_PATH.partial.$$"
PUBLISHING=0
HAD_ENC=0
HAD_HMAC=0
# Undo a half-finished pair publication: put back each previous file (or
# remove a new one that had no predecessor). `-ef`: a snapshot still linked to
# the untouched final only needs removing; mv between two links of the same
# file is a no-op that would leave the snapshot behind.
rollback_one() { # <final> <snapshot> <had a previous file>
  if (( $3 == 1 )); then
    if [[ -e "$2" ]]; then
      if [[ "$1" -ef "$2" ]]; then rm -f "$2"; else mv -f "$2" "$1"; fi
    fi
  else
    rm -f "$1"
  fi
}
cleanup() {
  if (( PUBLISHING == 1 )); then
    rollback_one "$ENC_PATH.hmac" "$PRIOR_PATH.hmac" "$HAD_HMAC" || true
    rollback_one "$ENC_PATH" "$PRIOR_PATH" "$HAD_ENC" || true
    if [[ -e "$PRIOR_PATH" || -e "$PRIOR_PATH.hmac" ]]; then
      echo "Could not put the previous backup back; it is kept as $PRIOR_PATH (+ .hmac)." >&2
    fi
  fi
  rm -f "$OUT_TMP" "$OUT_TMP.hmac"
  if (( OWN_LOCK == 1 )); then
    rm -f "$LOCK_DIR/owner"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "$ENGINE" == "openssl" ]]; then
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Another backup run is replacing today's backup, or an earlier run was interrupted." >&2
    echo "Lock: $LOCK_DIR" >&2
    echo "If no backup is running, check any kept pair ($PRIOR_PATH) with restore-keys --verify," >&2
    echo "then remove the lock folder and run the backup again. Nothing was written." >&2
    exit 1
  fi
  OWN_LOCK=1
  echo "$$" > "$LOCK_DIR/owner"
  if [[ -e "$PRIOR_PATH" || -e "$PRIOR_PATH.hmac" ]]; then
    echo "An earlier backup run was interrupted while replacing today's backup." >&2
    echo "The previous backup pair is kept as: $PRIOR_PATH (+ .hmac)" >&2
    echo "Check it with: npm run restore-keys -- --verify \"$PRIOR_PATH\"" >&2
    echo "Then keep or delete those two files and run the backup again. Nothing was written." >&2
    exit 1
  fi
fi

case "$ENGINE" in
  age)
    # age -p prompts for the passphrase on the terminal; data comes on stdin.
    printf '%s' "$VAULT_JSON" | age -p -o "$OUT_TMP"
    ;;
  gpg)
    # Interactive passphrase via pinentry; AES-256 with OpenPGP MDC and a
    # SHA-512 S2K (65M iterations). No compression (no length leak).
    printf '%s' "$VAULT_JSON" | gpg --symmetric \
        --cipher-algo AES256 \
        --s2k-digest-algo SHA512 \
        --s2k-count 65011712 \
        --compress-algo none \
        --output "$OUT_TMP"
    ;;
  openssl)
    echo
    echo "Set a password to encrypt the backup. You will need it to restore."
    read -r -s -p "Password: " PW1; echo
    read -r -s -p "Confirm:  " PW2; echo
    if [[ -z "$PW1" ]]; then
      echo "Empty password — refusing to encrypt." >&2
      exit 1
    fi
    if [[ "$PW1" != "$PW2" ]]; then
      echo "Passwords do not match." >&2
      exit 1
    fi
    unset PW2
    # Passphrase through a pipe fd, data on stdin: neither is in argv or on disk.
    printf '%s' "$VAULT_JSON" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
      -out "$OUT_TMP" -pass fd:3 3< <(printf '%s' "$PW1")
    # Sidecar HMAC-SHA256 over the ciphertext, verified before decrypting.
    # Known openssl(1) limitation: the passphrase is briefly in argv here.
    openssl dgst -sha256 -hmac "$PW1" -binary "$OUT_TMP" > "$OUT_TMP.hmac"
    unset PW1
    chmod 600 "$OUT_TMP.hmac"
    ;;
esac
unset VAULT_JSON
chmod 600 "$OUT_TMP"
if [[ "$ENGINE" == "openssl" ]]; then
  if [[ -e "$ENC_PATH" ]]; then HAD_ENC=1; fi
  if [[ -e "$ENC_PATH.hmac" ]]; then HAD_HMAC=1; fi
  PUBLISHING=1
  if (( HAD_ENC == 1 )); then ln "$ENC_PATH" "$PRIOR_PATH"; fi
  if (( HAD_HMAC == 1 )); then ln "$ENC_PATH.hmac" "$PRIOR_PATH.hmac"; fi
  mv -f "$OUT_TMP.hmac" "$ENC_PATH.hmac"
  mv -f "$OUT_TMP" "$ENC_PATH"
  PUBLISHING=0
  rm -f "$PRIOR_PATH" "$PRIOR_PATH.hmac"
else
  mv -f "$OUT_TMP" "$ENC_PATH"
fi

# ── Summary ─────────────────────────────────────────────────────────
echo
echo "Done. $COUNT keys backed up from $SOURCE."
echo "  Engine:  $ENGINE"
echo "  Output:  $ENC_PATH"
if [[ "$ENGINE" == "openssl" ]]; then
  echo "  HMAC:    $ENC_PATH.hmac (required for restore)"
fi
echo "  Permissions: 600 (owner-only)"
echo "Check it any time with: npm run restore-keys -- --verify \"$ENC_PATH\""
