#!/usr/bin/env bash
# Backup Crystal Ball API keys from macOS Keychain to iCloud Drive.
#
# Reads each known crystal-ball/* key from the keychain (service =
# "crystal-ball", account = key-name), writes it as a KEY=value line to
# a temp file, and produces two artefacts in iCloud Drive:
#
#   1. keys-backup-YYYYMMDD.enc — AES-256-CBC encrypted (PBKDF2, salted)
#   2. .env.local                — plaintext, suitable for the sidecar
#                                   fallback at src-tauri/sidecar/
#                                   env-local-loader.mjs
#
# The plaintext file lives behind iCloud's at-rest encryption but is
# readable by anyone with filesystem access to this Mac. That is a
# deliberate trade against the alternative (a keychain wipe with no
# recovery path). If you don't want plaintext in iCloud, pass --no-plain.
#
# Usage:
#   scripts/backup-keys.sh [--no-plain] [--dry-run]
#
# Exit codes:
#   0  success (at least one key backed up)
#   1  argument or environment error
#   2  no keys found in keychain (nothing backed up)

set -euo pipefail

KEYS=(
  ACLED_ACCESS_TOKEN ACLED_EMAIL FRED_API_KEY EIA_API_KEY
  NEWSDATA_API_KEY NASA_API_KEY NASA_FIRMS_API_KEY AIRNOW_API_KEY
  PURPLEAIR_API_KEY OWM_API_KEY FINNHUB_API_KEY NEWSAPI_KEY
  AVIATIONSTACK_API OPENSKY_CLIENT_ID OPENSKY_CLIENT_SECRET
  AISSTREAM_API_KEY CESIUM_ION_TOKEN GROQ_API_KEY OPENROUTER_API_KEY
  GEONAMES_USERNAME THREATFOX_API_KEY URLHAUS_AUTH_KEY OTX_API_KEY
  ABUSEIPDB_API_KEY VIRUSTOTAL_API_KEY SHODAN_API_KEY
  GREYNOISE_API_KEY URLSCAN_API_KEY ANTHROPIC_API_KEY
)

WRITE_PLAIN=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-plain) WRITE_PLAIN=0 ;;
    --dry-run)  DRY_RUN=1 ;;
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

ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CrystalBall"
DATE_TAG="$(date +%Y%m%d)"
ENC_PATH="$ICLOUD_DIR/keys-backup-$DATE_TAG.enc"
PLAIN_PATH="$ICLOUD_DIR/.env.local"

if [[ ! -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]]; then
  echo "iCloud Drive is not enabled on this Mac. Aborting." >&2
  exit 1
fi
mkdir -p "$ICLOUD_DIR"

TMP_DIR="$(mktemp -d -t crystalball-backup)"
TMP_PLAIN="$TMP_DIR/keys.env"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "Reading ${#KEYS[@]} keys from macOS Keychain (service=crystal-ball)..."
found=0
missing=()
for key in "${KEYS[@]}"; do
  if value=$(security find-generic-password -s "crystal-ball" -a "$key" -w 2>/dev/null); then
    if [[ -n "$value" ]]; then
      printf '%s=%s\n' "$key" "$value" >> "$TMP_PLAIN"
      found=$((found + 1))
    else
      missing+=("$key")
    fi
  else
    missing+=("$key")
  fi
done

echo "Found $found / ${#KEYS[@]} keys in keychain."
if (( ${#missing[@]} > 0 )); then
  echo "Missing: ${missing[*]}"
fi

if (( found == 0 )); then
  echo "No keys found in keychain — nothing to back up." >&2
  exit 2
fi

if (( DRY_RUN == 1 )); then
  echo "[dry-run] Would write encrypted backup to: $ENC_PATH"
  if (( WRITE_PLAIN == 1 )); then
    echo "[dry-run] Would write plaintext .env.local to: $PLAIN_PATH"
  fi
  exit 0
fi

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

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$TMP_PLAIN" -out "$ENC_PATH" -pass "pass:$PW1"
chmod 600 "$ENC_PATH"
echo "Encrypted backup → $ENC_PATH"

if (( WRITE_PLAIN == 1 )); then
  install -m 600 "$TMP_PLAIN" "$PLAIN_PATH"
  echo "Plaintext .env.local → $PLAIN_PATH"
  echo "  (readable by anyone with filesystem access to this Mac;"
  echo "   protected at rest by iCloud Drive encryption only.)"
fi

echo
echo "Done. $found keys backed up."
