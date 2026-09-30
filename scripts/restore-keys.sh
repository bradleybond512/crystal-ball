#!/usr/bin/env bash
# Restore Crystal Ball's API keys from an encrypted backup into the app's
# Keychain vault. Pairs with scripts/backup-keys.sh. Run by Bradley only
# (CLAUDE.md Keychain rule); agents test it against a stub `security`.
#
# Usage:
#   scripts/restore-keys.sh [--verify] [--replace] <backup file>
#
# Accepted files: keys-backup-YYYYMMDD-{age,gpg,openssl}.enc from
# backup-keys.sh, or a plain `.age` file (the manual vault backup). Both the
# vault JSON format and the older KEY=value format are understood.
#
# --verify   decrypt and list the key NAMES and count; no Keychain access.
# --replace  make the vault exactly match the backup. Default: merge — backup
#            values overwrite the same names, keys added since the backup are
#            kept.
#
# Safety:
#   - integrity is checked before anything is written (age/gpg AEAD/MDC,
#     openssl sidecar HMAC);
#   - the decrypted keys stay in memory (no temp files);
#   - refuses while Crystal Ball is running (the app would overwrite the vault);
#   - the vault is written through `security -i` on stdin as hex, so no key
#     ever appears in a process's arguments; a read-back confirms the write.
#
# Exit codes:
#   0  success (or aborted at the confirmation prompt)
#   1  argument / file / decryption / integrity / Keychain error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_TOOL="$SCRIPT_DIR/vault-json.mjs"
MAIN_RS="$REPO_ROOT/src-tauri/src/main.rs"
SERVICE="crystal-ball"
VAULT_ACCOUNT="secrets-vault"
ERR_ITEM_NOT_FOUND=44
APP_PROCESS="crystalball"

VERIFY_ONLY=0
REPLACE=0
ENC_PATH=""
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY_ONLY=1 ;;
    --replace) REPLACE=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 1
      ;;
    *)
      if [[ -n "$ENC_PATH" ]]; then
        echo "more than one input file given" >&2
        exit 1
      fi
      ENC_PATH="$arg"
      ;;
  esac
done

if [[ -z "$ENC_PATH" ]]; then
  echo "usage: $0 [--verify] [--replace] <backup file>" >&2
  exit 1
fi
if [[ ! -f "$ENC_PATH" ]]; then
  echo "file not found: $ENC_PATH" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required (it validates the backup in memory)." >&2
  exit 1
fi

# ── Detect engine from filename suffix ──────────────────────────────
case "$ENC_PATH" in
  *-age.enc|*.age) ENGINE="age" ;;
  *-gpg.enc)       ENGINE="gpg" ;;
  *-openssl.enc)   ENGINE="openssl" ;;
  *)
    echo "Cannot detect engine from filename: $ENC_PATH" >&2
    echo "Expected -age.enc, -gpg.enc, -openssl.enc or .age." >&2
    exit 1
    ;;
esac
if ! command -v "$ENGINE" >/dev/null 2>&1; then
  echo "Backup uses $ENGINE but $ENGINE is not installed." >&2
  exit 1
fi
echo "Encryption engine: $ENGINE"

# ── Decrypt into memory (integrity checked by the engine) ───────────
case "$ENGINE" in
  age)
    if ! PLAIN="$(age -d "$ENC_PATH")"; then
      echo "Integrity check failed (wrong passphrase or corrupt file)." >&2
      exit 1
    fi
    ;;
  gpg)
    if ! PLAIN="$(gpg --decrypt "$ENC_PATH" 2>/dev/null)"; then
      echo "Integrity check failed (wrong passphrase or corrupt file)." >&2
      exit 1
    fi
    ;;
  openssl)
    HMAC_PATH="$ENC_PATH.hmac"
    if [[ ! -f "$HMAC_PATH" ]]; then
      echo "openssl backup requires sidecar HMAC at: $HMAC_PATH" >&2
      exit 1
    fi
    read -r -s -p "Password: " PW; echo
    if [[ -z "$PW" ]]; then
      echo "Empty password." >&2
      exit 1
    fi
    # Compare the HMAC before decrypting anything.
    expected="$(openssl dgst -sha256 -hmac "$PW" -binary "$ENC_PATH" | od -An -tx1 | tr -d ' \n')"
    actual="$(od -An -tx1 < "$HMAC_PATH" | tr -d ' \n')"
    if [[ -z "$expected" || "$expected" != "$actual" ]]; then
      echo "Integrity check failed: HMAC mismatch (wrong passphrase or tampered file)." >&2
      exit 1
    fi
    if ! PLAIN="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$ENC_PATH" -pass fd:3 3< <(printf '%s' "$PW") 2>/dev/null)"; then
      echo "Decryption failed despite HMAC match — file format may be incompatible." >&2
      exit 1
    fi
    unset PW
    ;;
esac

if ! BACKUP_JSON="$(printf '%s' "$PLAIN" | node "$VAULT_TOOL" normalize --supported "$MAIN_RS")"; then
  unset PLAIN
  echo "The decrypted backup is not a valid key vault. Nothing was written." >&2
  exit 1
fi
unset PLAIN
BACKUP_COUNT="$(printf '%s' "$BACKUP_JSON" | node "$VAULT_TOOL" count)"

# ── Verify mode: names + count, no Keychain access ──────────────────
if (( VERIFY_ONLY == 1 )); then
  echo
  echo "Backup contents (names only, values never shown):"
  printf '%s' "$BACKUP_JSON" | node "$VAULT_TOOL" names | sed 's/^/  /'
  echo
  echo "Total: $BACKUP_COUNT keys. Backup integrity OK."
  exit 0
fi

if (( BACKUP_COUNT == 0 )); then
  echo "The backup contains no keys. Nothing was written." >&2
  exit 1
fi

# ── The app must be quit: it holds the keys in memory and rewrites the vault
if pgrep -x "$APP_PROCESS" >/dev/null 2>&1; then
  echo "Crystal Ball is running. Quit it first (Crystal Ball > Quit), then run the restore again." >&2
  exit 1
fi

# ── Build the vault to write ────────────────────────────────────────
if (( REPLACE == 1 )); then
  NEW_JSON="$BACKUP_JSON"
  echo "Mode: replace — the vault will contain exactly the $BACKUP_COUNT backed-up keys."
else
  set +e
  CURRENT_RAW="$(security find-generic-password -s "$SERVICE" -a "$VAULT_ACCOUNT" -w 2>/dev/null)"
  status=$?
  set -e
  if (( status == ERR_ITEM_NOT_FOUND )); then
    CURRENT_JSON="{}"
  elif (( status != 0 )); then
    echo "Could not read the current secrets-vault item (security exit $status)." >&2
    echo "Choose Allow if macOS asks, or use --replace to restore the backup exactly." >&2
    exit 1
  elif ! CURRENT_JSON="$(printf '%s' "$CURRENT_RAW" | node "$VAULT_TOOL" normalize)"; then
    unset CURRENT_RAW
    echo "The current vault is not valid JSON. Use --replace to restore the backup exactly." >&2
    exit 1
  fi
  unset CURRENT_RAW
  NEW_JSON="$(node "$VAULT_TOOL" merge 3< <(printf '%s' "$CURRENT_JSON") 4< <(printf '%s' "$BACKUP_JSON"))"
  unset CURRENT_JSON
fi
unset BACKUP_JSON
NEW_COUNT="$(printf '%s' "$NEW_JSON" | node "$VAULT_TOOL" count)"

# ── Confirm (bash 3.2-safe) ─────────────────────────────────────────
echo
echo "About to write $NEW_COUNT keys to the Crystal Ball vault (Keychain: $SERVICE / $VAULT_ACCOUNT)."
read -r -p "Proceed? [y/N] " ans || ans=""
case "$ans" in
  y|Y|yes|Yes|YES) ;;
  *)
    echo "Aborted. Nothing was written."
    exit 0
    ;;
esac

# ── Write via stdin as hex: no key in any process's arguments ───────
HEX="$(printf '%s' "$NEW_JSON" | node "$VAULT_TOOL" hex)"
if ! printf 'add-generic-password -U -s %s -a %s -X %s\n' "$SERVICE" "$VAULT_ACCOUNT" "$HEX" | security -i >/dev/null 2>&1; then
  unset HEX NEW_JSON
  echo "Writing the vault to the Keychain failed." >&2
  exit 1
fi
unset HEX

# ── Read back and confirm ───────────────────────────────────────────
if ! CHECK_RAW="$(security find-generic-password -s "$SERVICE" -a "$VAULT_ACCOUNT" -w 2>/dev/null)"; then
  unset NEW_JSON
  echo "The vault was written but could not be read back to confirm it." >&2
  exit 1
fi
CHECK_JSON="$(printf '%s' "$CHECK_RAW" | node "$VAULT_TOOL" normalize 2>/dev/null || true)"
unset CHECK_RAW
if [[ "$CHECK_JSON" != "$NEW_JSON" ]]; then
  unset CHECK_JSON NEW_JSON
  echo "The vault read back does not match what was written. Do not start the app; run the restore again." >&2
  exit 1
fi
unset CHECK_JSON NEW_JSON

echo
echo "Restored: the vault now holds $NEW_COUNT keys (confirmed by reading it back)."
echo "Start Crystal Ball. If macOS asks for access to the \"$SERVICE\" item, choose Always Allow for Crystal Ball."
