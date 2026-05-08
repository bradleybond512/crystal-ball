#!/usr/bin/env bash
# Restore Crystal Ball API keys from an encrypted backup into macOS
# Keychain. Pairs with scripts/backup-keys.sh.
#
# Usage:
#   scripts/restore-keys.sh <path/to/keys-backup.enc>
#
# Decrypts the file with a password you provide, then writes each
# KEY=value line back to the keychain with:
#   security add-generic-password -U -s "crystal-ball" -a KEY -w VALUE
#
# The -U flag updates an existing entry rather than failing — restore
# is idempotent.
#
# Exit codes:
#   0  success
#   1  argument / file / decryption error

set -euo pipefail

if (( $# != 1 )); then
  echo "usage: $0 <path/to/keys-backup.enc>" >&2
  exit 1
fi

ENC_PATH="$1"
if [[ ! -f "$ENC_PATH" ]]; then
  echo "file not found: $ENC_PATH" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d -t crystalball-restore)"
TMP_PLAIN="$TMP_DIR/keys.env"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "Decrypting $ENC_PATH..."
read -r -s -p "Password: " PW; echo
if [[ -z "$PW" ]]; then
  echo "Empty password." >&2
  exit 1
fi

if ! openssl enc -d -aes-256-cbc -pbkdf2 \
       -in "$ENC_PATH" -out "$TMP_PLAIN" -pass "pass:$PW" 2>/dev/null; then
  echo "Decryption failed — wrong password or corrupt file." >&2
  exit 1
fi

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
