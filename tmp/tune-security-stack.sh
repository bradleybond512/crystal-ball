#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
ZEEK_LOCAL="/opt/homebrew/share/zeek/site/local.zeek"
ZEEK_INTEL_UPDATE="/opt/homebrew/bin/zeek-intel-update.py"
ZEEK_INTEL="/opt/homebrew/share/zeek/site/intel/combined.intel"
SURICATA_PID="/opt/homebrew/var/run/suricata.pid"

echo "== Stopping broken Suricata jobs =="
sudo launchctl disable system/com.bradleybond.suricata || true
sudo launchctl bootout system/com.bradleybond.suricata || true

sudo launchctl disable system/com.bradleybond.suricata-blocker || true
sudo launchctl bootout system/com.bradleybond.suricata-blocker || true

launchctl disable "gui/$(id -u)/com.bradleybond.suricata-alerts" || true
launchctl bootout "gui/$(id -u)/com.bradleybond.suricata-alerts" || true

sudo rm -f "$SURICATA_PID"

echo
echo "== Backing up Zeek files =="
sudo cp "$ZEEK_LOCAL" "$ZEEK_LOCAL.bak-$STAMP"
sudo cp "$ZEEK_INTEL_UPDATE" "$ZEEK_INTEL_UPDATE.bak-$STAMP"

echo
echo "== Disabling Zeek telemetry log =="
sudo perl -0pi -e 's/^\@load frameworks\/telemetry\/log$/# @load frameworks\/telemetry\/log/m' "$ZEEK_LOCAL"

echo
echo "== Adding Zeek intel allowlist =="
sudo python3 - <<'PY'
from pathlib import Path

path = Path("/opt/homebrew/bin/zeek-intel-update.py")
text = path.read_text()

if "DOMAIN_ALLOWLIST" not in text:
    text = text.replace(
'''FEEDS = {
    "feodo_ips": "https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
    "urlhaus_urls": "https://urlhaus.abuse.ch/downloads/text/",
}
''',
'''FEEDS = {
    "feodo_ips": "https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
    "urlhaus_urls": "https://urlhaus.abuse.ch/downloads/text/",
}

DOMAIN_ALLOWLIST = {
    "github.com",
    "gist.github.com",
    "codeload.github.com",
    "release-assets.githubusercontent.com",
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "cdn.jsdelivr.net",
}
'''
    )

text = text.replace(
'''        if host in seen:
            continue
        seen.add(host)
''',
'''        if host in seen or host in DOMAIN_ALLOWLIST:
            continue
        seen.add(host)
'''
)

path.write_text(text)
PY

echo
echo "== Regenerating intel and restarting Zeek =="
sudo "$ZEEK_INTEL_UPDATE"
sudo launchctl kickstart -k system/com.bradleybond.zeek

echo
echo "== Verification =="
launchctl print system/com.bradleybond.suricata 2>&1 | grep -E 'state =|runs =|pid =|last exit|Could not|Bad request' || true
launchctl print system/com.bradleybond.suricata-blocker 2>&1 | grep -E 'state =|runs =|pid =|last exit|Could not|Bad request' || true
launchctl print "gui/$(id -u)/com.bradleybond.suricata-alerts" 2>&1 | grep -E 'state =|runs =|pid =|last exit|Could not|Bad request' || true
launchctl print system/com.bradleybond.zeek 2>&1 | grep -E 'state =|runs =|pid =|last exit|Could not|Bad request' || true

echo
grep -n 'telemetry/log' "$ZEEK_LOCAL" || true
grep -n 'DOMAIN_ALLOWLIST' "$ZEEK_INTEL_UPDATE" || true
grep -E '^(github\.com|gist\.github\.com|codeload\.github\.com|release-assets\.githubusercontent\.com|storage\.googleapis\.com|firebasestorage\.googleapis\.com|cdn\.jsdelivr\.net)[[:space:]]' "$ZEEK_INTEL" || true

echo
ls -lh "$SURICATA_PID" /opt/homebrew/var/log/zeek/telemetry.log 2>/dev/null || true
