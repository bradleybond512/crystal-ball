#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-$HOME/SecurityStackAudits}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/security-stack-audit-$STAMP.txt"

mkdir -p "$OUT_DIR"

section() {
  printf '\n== %s ==\n' "$1" | tee -a "$REPORT"
}

run() {
  printf '\n$ %s\n' "$*" | tee -a "$REPORT"
  "$@" 2>&1 | tee -a "$REPORT" || true
}

run_shell() {
  printf '\n$ %s\n' "$1" | tee -a "$REPORT"
  bash -lc "$1" 2>&1 | tee -a "$REPORT" || true
}

status_line() {
  printf '%-34s %s\n' "$1" "$2" | tee -a "$REPORT"
}

loaded_system() {
  launchctl print "system/$1" >/dev/null 2>&1 && echo loaded || echo "not loaded"
}

loaded_gui() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 && echo loaded || echo "not loaded"
}

: > "$REPORT"

section "Audit Metadata"
status_line "report" "$REPORT"
status_line "host" "$(hostname)"
status_line "user" "$(id -un)"
status_line "date" "$(date)"
status_line "macOS" "$(sw_vers -productVersion 2>/dev/null || echo unknown)"
status_line "build" "$(sw_vers -buildVersion 2>/dev/null || echo unknown)"

section "macOS Baseline Protections"
run /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
run /usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode
run /usr/libexec/ApplicationFirewall/socketfilterfw --getallowsigned
run /usr/libexec/ApplicationFirewall/socketfilterfw --getblockall
run spctl --status
run csrutil status
run fdesetup status

section "Security Launch Services"
for label in \
  com.bradleybond.zeek \
  com.bradleybond.zeek-intel-update \
  com.bradleybond.zeek-log-rotate \
  com.bradleybond.suricata \
  com.bradleybond.suricata-blocker \
  com.bradleybond.suricata-update \
  homebrew.mxcl.dnscrypt-proxy \
  com.objective-see.blockblock \
  com.malwarebytes.mbam.rtprotection.daemon \
  com.malwarebytes.mbam.settings.daemon
do
  status_line "$label" "$(loaded_system "$label")"
done

for label in \
  com.bradleybond.suricata-alerts \
  com.bradleybond.malwarebytes-monthly \
  com.malwarebytes.mbam.frontend.agent
do
  status_line "$label" "$(loaded_gui "$label")"
done

section "Installed Security Tools"
for formula in zeek suricata dnscrypt-proxy lulu-cli nmap yara clamav osquery gitleaks trufflehog detect-secrets; do
  if brew list --formula "$formula" >/dev/null 2>&1; then
    status_line "$formula" "installed $(brew list --versions "$formula" | sed "s/^$formula //")"
  else
    status_line "$formula" "not installed"
  fi
done

for cask in little-snitch oversight malwarebytes tailscale wireguard lulu; do
  if brew list --cask "$cask" >/dev/null 2>&1; then
    status_line "$cask" "installed $(brew list --versions --cask "$cask" | sed "s/^$cask //")"
  else
    status_line "$cask" "not installed via brew"
  fi
done

for app in \
  "/Applications/Little Snitch.app" \
  "/Applications/LuLu.app" \
  "/Applications/BlockBlock Helper.app" \
  "/Applications/OverSight.app" \
  "/Applications/Malwarebytes.app" \
  "/Applications/Tailscale.app"
do
  [ -d "$app" ] && status_line "$app" present || status_line "$app" absent
done

section "Little Snitch And LuLu"
status_line "Little Snitch app" "$([ -d '/Applications/Little Snitch.app' ] && echo present || echo absent)"
status_line "LuLu app" "$([ -d '/Applications/LuLu.app' ] && echo present || echo absent)"
status_line "LuLu config" "$([ -d '/Library/Objective-See/LuLu' ] && echo present || echo absent)"
if command -v lulu-cli >/dev/null 2>&1; then
  run_shell "lulu-cli list 2>&1 | awk 'BEGIN{rules=0; allow=0; block=0} / \\| Allow \\|/{allow++; rules++} / \\| Block \\|/{block++; rules++} END{print \"rules=\" rules; print \"allow=\" allow; print \"block=\" block}'"
  run_shell "lulu-cli recent 20 2>&1"
fi

section "Malwarebytes"
run_shell "find '/Library/Application Support/Malwarebytes' -maxdepth 4 -type f -o -type d 2>/dev/null | sed -n '1,80p'"
run_shell "launchctl print gui/$(id -u)/com.malwarebytes.mbam.frontend.agent 2>&1 | sed -n '1,80p'"
run_shell "launchctl print system/com.malwarebytes.mbam.rtprotection.daemon 2>&1 | sed -n '1,80p'"
run_shell "tail -40 '$HOME/Library/Logs/malwarebytes_scheduled.log' 2>/dev/null"

section "Network DNS And VPN"
run_shell "scutil --dns | sed -n '1,120p'"
run_shell "ifconfig | grep -E '^[a-z0-9]+:|status:|inet |inet6 ' | sed -n '1,180p'"
run_shell "netstat -rn -f inet | sed -n '1,120p'"

section "Listening Ports"
if command -v lsof >/dev/null 2>&1; then
  run_shell "lsof -nP -iTCP -sTCP:LISTEN | sed -n '1,160p'"
fi
run_shell "netstat -anv -p tcp | grep LISTEN | sed -n '1,120p'"

section "Launch Item Inventory"
run_shell "find '$HOME/Library/LaunchAgents' /Library/LaunchAgents /Library/LaunchDaemons -maxdepth 1 -type f 2>/dev/null | sort | sed -n '1,240p'"

section "System Extensions"
run_shell "systemextensionsctl list 2>&1 | sed -n '1,160p'"

section "Security Log Footprint"
run_shell "du -sh /opt/homebrew/var/log/zeek /opt/homebrew/var/log/suricata /Library/Logs /var/log 2>/dev/null"
run_shell "find /opt/homebrew/var/log/zeek /opt/homebrew/var/log/suricata -maxdepth 1 -type f -size +10M -exec ls -lh {} \\; 2>/dev/null"

section "Browser Surface"
for app in \
  "/Applications/Safari.app" \
  "/Applications/Google Chrome.app" \
  "/Applications/Brave Browser.app" \
  "/Applications/Firefox.app" \
  "/Applications/Arc.app"
do
  [ -d "$app" ] && status_line "$app" present || true
done
run_shell "find '$HOME/Library/Application Support/Google/Chrome/Default/Extensions' '$HOME/Library/Application Support/BraveSoftware/Brave-Browser/Default/Extensions' '$HOME/Library/Application Support/Firefox/Profiles' -maxdepth 2 -type d 2>/dev/null | sed -n '1,160p'"

section "Unsigned Or Ad Hoc Apps"
run_shell "find /Applications '$HOME/Applications' -maxdepth 2 -name '*.app' -print 2>/dev/null | while read -r app; do codesign -dv --verbose=2 \"\$app\" >/tmp/security-stack-codesign.$$ 2>&1 || true; if grep -Eq 'Signature=adhoc|code object is not signed|not signed' /tmp/security-stack-codesign.$$; then echo \"\$app\"; fi; done; rm -f /tmp/security-stack-codesign.$$"

section "Homebrew Drift"
run_shell "brew outdated --formula 2>/dev/null | sed -n '1,120p'"
run_shell "brew outdated --cask 2>/dev/null | sed -n '1,120p'"
run_shell "brew services list 2>/dev/null | sed -n '1,120p'"

section "Recommendations"
{
  echo "- Firewall should be enabled and stealth mode should be on."
  echo "- Little Snitch and LuLu should not both be used long-term; prefer Little Snitch after it is approved."
  echo "- Zeek should be disabled or uninstalled unless you actively review its logs."
  echo "- Suricata should remain disabled/uninstalled on this laptop."
  echo "- dnscrypt-proxy should remain disabled/uninstalled if Little Snitch DNS encryption or Cloudflare/Tailscale DNS is your chosen path."
  echo "- Malwarebytes should be repaired/reinstalled or converted to manual scan only."
  echo "- Review listening ports and launch items monthly."
} | tee -a "$REPORT"

section "Report Saved"
echo "$REPORT" | tee -a "$REPORT"
