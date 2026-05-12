#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./tmp/security-stack-clean-logs.sh [options]

Options:
  --archive-zeek     Compress current Zeek logs into ~/SecurityStackBackups/<timestamp>/zeek-logs.tar.gz, then remove current .log files.
  --archive-suricata Compress current Suricata logs into ~/SecurityStackBackups/<timestamp>/suricata-logs.tar.gz, then remove current .log/.json files.
  --help             Show this help.
EOF
}

ARCHIVE_ZEEK=0
ARCHIVE_SURICATA=0

for arg in "$@"; do
  case "$arg" in
    --archive-zeek) ARCHIVE_ZEEK=1 ;;
    --archive-suricata) ARCHIVE_SURICATA=1 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

if [ "$#" -eq 0 ]; then
  usage
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/SecurityStackBackups/$STAMP"
mkdir -p "$BACKUP_DIR"

if [ "$ARCHIVE_ZEEK" -eq 1 ] && [ -d /opt/homebrew/var/log/zeek ]; then
  echo "== Archiving Zeek logs =="
  sudo tar -czf "$BACKUP_DIR/zeek-logs.tar.gz" -C /opt/homebrew/var/log zeek
  sudo find /opt/homebrew/var/log/zeek -maxdepth 1 -type f -name '*.log' -delete
fi

if [ "$ARCHIVE_SURICATA" -eq 1 ] && [ -d /opt/homebrew/var/log/suricata ]; then
  echo "== Archiving Suricata logs =="
  sudo tar -czf "$BACKUP_DIR/suricata-logs.tar.gz" -C /opt/homebrew/var/log suricata
  sudo find /opt/homebrew/var/log/suricata -maxdepth 1 -type f \( -name '*.log' -o -name '*.json' \) -delete
fi

echo "Backups: $BACKUP_DIR"
