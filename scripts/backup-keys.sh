#!/usr/bin/env bash
# Backup Crystal Ball API keys from macOS Keychain to iCloud Drive.
#
# Reads each known crystal-ball/* keychain entry, writes it as a
# KEY=value line into a temp file, then encrypts the temp file with
# the strongest available tool and stores the result in iCloud Drive.
#
# Encryption engine priority:
#   1. age      — ChaCha20-Poly1305 AEAD, Argon2id KDF, no footgun modes
#                 (https://age-encryption.org). brew install age.
#   2. gpg      — AES256 + SHA512 + iterated S2K + OpenPGP MDC.
#   3. openssl  — AES-256-CBC + PBKDF2-HMAC-SHA256 (600,000 iters,
#                 NIST SP 800-132 2023) + sidecar HMAC-SHA256 for
#                 integrity. Sidecar passphrase is briefly visible in
#                 /proc / ps args during HMAC computation; on a
#                 personal Mac this is acceptable, but install age or
#                 gpg if that bothers you.
#
# Output filename embeds the engine so restore knows what to do:
#   keys-backup-YYYYMMDD-{age,gpg,openssl}.enc
#
# Usage:
#   scripts/backup-keys.sh [--dry-run]
#
# Exit codes:
#   0  success (at least one key backed up)
#   1  argument / environment / encryption error
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
DATE_TAG="$(date +%Y%m%d)"
ENC_PATH="$ICLOUD_DIR/keys-backup-$DATE_TAG-$ENGINE.enc"

if [[ ! -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]]; then
  echo "iCloud Drive is not enabled on this Mac. Aborting." >&2
  exit 1
fi
mkdir -p "$ICLOUD_DIR"

TMP_DIR="$(mktemp -d -t crystalball-backup)"
chmod 700 "$TMP_DIR"
TMP_PLAIN="$TMP_DIR/keys.env"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

# ── Read keys from keychain ─────────────────────────────────────────
echo "Reading ${#KEYS[@]} keys from macOS Keychain (service=crystal-ball)..."
found=0
missing=()
: > "$TMP_PLAIN"
chmod 600 "$TMP_PLAIN"
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
unset value

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
  if [[ "$ENGINE" == "openssl" ]]; then
    echo "[dry-run] Would also write HMAC sidecar to:   $ENC_PATH.hmac"
  fi
  exit 0
fi

# ── Encrypt ─────────────────────────────────────────────────────────
case "$ENGINE" in
  age)
    # age -p prompts for passphrase + confirmation interactively. Salt
    # is per-file random (Argon2id). Wrong passphrase fails AEAD on decrypt.
    age -p -o "$ENC_PATH" "$TMP_PLAIN"
    ;;
  gpg)
    # --batch=false keeps the interactive prompt + confirmation. AES-256
    # in CFB with OpenPGP MDC; SHA-512 S2K with iteration count 65M.
    # --compress-algo none avoids leaking length info via compression.
    gpg --batch=false \
        --symmetric \
        --cipher-algo AES256 \
        --s2k-digest-algo SHA512 \
        --s2k-count 65011712 \
        --compress-algo none \
        --output "$ENC_PATH" \
        "$TMP_PLAIN"
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
    # Passphrase via stdin (-pass stdin) keeps it out of process args.
    # PBKDF2-HMAC-SHA256 with 600,000 iterations matches NIST SP 800-132
    # (2023). Random 8-byte salt is written into the openssl header.
    printf '%s' "$PW1" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
      -in "$TMP_PLAIN" -out "$ENC_PATH" -pass stdin
    # Sidecar HMAC-SHA256 over the ciphertext using the passphrase as key.
    # Verified on restore BEFORE decryption so a tampered or corrupted
    # file doesn't get fed to the decrypter. Note: the passphrase is
    # briefly visible in process args during this command — a known
    # openssl(1) limitation.
    openssl dgst -sha256 -hmac "$PW1" -binary "$ENC_PATH" > "$ENC_PATH.hmac"
    unset PW1
    chmod 600 "$ENC_PATH.hmac"
    ;;
esac

chmod 600 "$ENC_PATH"

# ── Summary ─────────────────────────────────────────────────────────
echo
echo "Done. $found keys backed up."
echo "  Engine:  $ENGINE"
echo "  Output:  $ENC_PATH"
if [[ "$ENGINE" == "openssl" ]]; then
  echo "  HMAC:    $ENC_PATH.hmac (required for restore)"
fi
echo "  Permissions: 600 (owner-only)"
