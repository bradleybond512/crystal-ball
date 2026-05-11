#!/usr/bin/env bash
# Restore Crystal Ball API keys from an encrypted backup into macOS
# Keychain. Pairs with scripts/backup-keys.sh.
#
# Usage:
#   scripts/restore-keys.sh [--verify] <path/to/keys-backup-YYYYMMDD-{age,gpg,openssl}.enc>
#
# The encryption engine is auto-detected from the filename suffix
# (-age.enc / -gpg.enc / -openssl.enc).
#
# Integrity is checked BEFORE any keychain writes:
#   - age + gpg use AEAD / MDC. Wrong passphrase or tampered ciphertext
#     fails decryption with a non-zero exit and the script aborts.
#   - openssl uses a sidecar HMAC-SHA256 file (.hmac); we recompute and
#     compare before decrypting.
#
# --verify  decrypts and prints the KEY names contained in the backup
#           without writing anything to keychain. Use this first to
#           confirm a backup is valid before committing to a restore.
#
# Exit codes:
#   0  success
#   1  argument / file / decryption / integrity / write error

set -euo pipefail

VERIFY_ONLY=0
ENC_PATH=""
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY_ONLY=1 ;;
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
  echo "usage: $0 [--verify] <path/to/keys-backup-YYYYMMDD-{age,gpg,openssl}.enc>" >&2
  exit 1
fi
if [[ ! -f "$ENC_PATH" ]]; then
  echo "file not found: $ENC_PATH" >&2
  exit 1
fi

# ── Detect engine from filename suffix ──────────────────────────────
ENGINE=""
case "$ENC_PATH" in
  *-age.enc)     ENGINE="age" ;;
  *-gpg.enc)     ENGINE="gpg" ;;
  *-openssl.enc) ENGINE="openssl" ;;
  *)
    echo "Cannot detect engine from filename: $ENC_PATH" >&2
    echo "Expected suffix -age.enc, -gpg.enc, or -openssl.enc." >&2
    exit 1
    ;;
esac
if ! command -v "$ENGINE" >/dev/null 2>&1; then
  echo "Backup uses $ENGINE but $ENGINE is not installed." >&2
  exit 1
fi
echo "Encryption engine: $ENGINE"

TMP_DIR="$(mktemp -d -t crystalball-restore)"
chmod 700 "$TMP_DIR"
TMP_PLAIN="$TMP_DIR/keys.env"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

# ── Decrypt + integrity check ───────────────────────────────────────
case "$ENGINE" in
  age)
    # AEAD: wrong passphrase or tampered file fails decryption.
    if ! age -d -o "$TMP_PLAIN" "$ENC_PATH"; then
      echo "Integrity check failed (wrong passphrase or corrupt file)." >&2
      exit 1
    fi
    ;;
  gpg)
    # OpenPGP MDC: tampered file fails. Wrong passphrase exits non-zero.
    if ! gpg --decrypt --output "$TMP_PLAIN" "$ENC_PATH" 2>/dev/null; then
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
    # Recompute HMAC over the ciphertext and compare to the sidecar.
    # If this fails, abort BEFORE attempting decryption.
    EXPECTED="$TMP_DIR/expected.hmac"
    openssl dgst -sha256 -hmac "$PW" -binary "$ENC_PATH" > "$EXPECTED"
    if ! cmp -s "$EXPECTED" "$HMAC_PATH"; then
      echo "Integrity check failed: HMAC mismatch." >&2
      echo "Either the passphrase is wrong or the file has been tampered with." >&2
      exit 1
    fi
    rm -f "$EXPECTED"
    # HMAC matched → passphrase is correct AND ciphertext is intact.
    if ! printf '%s' "$PW" | openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
            -in "$ENC_PATH" -out "$TMP_PLAIN" -pass stdin 2>/dev/null; then
      # Should not happen after HMAC pass — would mean format mismatch.
      echo "Decryption failed despite HMAC match — file format may be incompatible." >&2
      exit 1
    fi
    unset PW
    ;;
esac

chmod 600 "$TMP_PLAIN"

# ── Verify mode: list key names + exit ──────────────────────────────
if (( VERIFY_ONLY == 1 )); then
  echo
  echo "Backup contents (KEY names only, values not shown):"
  count=0
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    if [[ -n "$key" && "$key" != "$line" ]]; then
      echo "  $key"
      count=$((count + 1))
    fi
  done < "$TMP_PLAIN"
  echo
  echo "Total: $count keys. Backup integrity OK."
  exit 0
fi

# ── Confirm + write to keychain ─────────────────────────────────────
echo
echo "About to write keys to the macOS Keychain (service=crystal-ball)."
read -r -p "Proceed? [y/N] " ans
if [[ "${ans,,}" != "y" && "${ans,,}" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

restored=0
failed=0
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  if [[ -z "$key" || "$key" == "$line" ]]; then
    continue
  fi
  if security add-generic-password -U -s "crystal-ball" -a "$key" -w "$value" 2>/dev/null; then
    restored=$((restored + 1))
  else
    failed=$((failed + 1))
    echo "  ! failed to write $key" >&2
  fi
done < "$TMP_PLAIN"

echo
echo "Restored $restored keys to keychain."
if (( failed > 0 )); then
  echo "$failed keys failed — see above." >&2
  exit 1
fi
