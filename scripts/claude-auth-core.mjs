// Pure analysis behind `npm run doctor:claude-auth`.
//
// The CLI collects a plain probe object from the local machine and hands it
// here; every rule below is a pure function of that probe so the whole matrix
// stays unit-testable offline.
//
// KEYCHAIN: this module and its CLI never invoke `security(1)` in any form.
// Per CLAUDE.md the Keychain belongs to the running application only, so the
// macOS credential item is reported as "verify by hand", never probed.

const SEVERITY_RANK = { red: 0, yellow: 1 };

// Env vars that override or short-circuit the stored OAuth session. Each one
// can make a correctly-stored login look like it "did not stick".
const AUTH_ENV_VARS = [
  ['ANTHROPIC_API_KEY', 'forces API-key auth, so the OAuth session is never used or refreshed'],
  ['ANTHROPIC_AUTH_TOKEN', 'replaces the stored token on every launch'],
  ['CLAUDE_CODE_OAUTH_TOKEN', 'pins one token that is never refreshed once it expires'],
  ['ANTHROPIC_BASE_URL', 'points the CLI at an endpoint that cannot refresh an Anthropic session'],
];

// Directories whose sync/eviction behaviour rewrites files behind the CLI.
const CLOUD_SYNC_MARKERS = [
  ['Library/Mobile Documents', 'iCloud Drive'],
  ['Dropbox', 'Dropbox'],
  ['Google Drive', 'Google Drive'],
  ['GoogleDrive', 'Google Drive'],
  ['OneDrive', 'OneDrive'],
];

const MIN_FREE_BYTES = 200 * 1024 * 1024;

export function buildClaudeAuthReport(probe) {
  const findings = [];

  inspectConfig(probe, findings);
  inspectOwnership(probe, findings);
  inspectCloudSync(probe, findings);
  inspectCredentials(probe, findings);
  inspectDisk(probe, findings);
  inspectEnv(probe, findings);
  inspectInstalls(probe, findings);

  findings.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return bySeverity !== 0 ? bySeverity : a.priority - b.priority;
  });

  return {
    status: statusFromFindings(findings),
    platform: probe.platform ?? 'unknown',
    checked: probe.configPath ?? null,
    findings,
  };
}

export function statusFromFindings(findings) {
  if (findings.some((f) => f.severity === 'red')) return 'red';
  if (findings.some((f) => f.severity === 'yellow')) return 'yellow';
  return 'ok';
}

// Findings whose remediation the CLI may perform on its own: deleting a stale
// scratch file we already own is reversible and touches no credential.
export function autoFixableFindings(report) {
  return report.findings.filter((f) => f.autoFix === true);
}

function inspectConfig(probe, findings) {
  const config = probe.config ?? {};
  if (!config.exists) {
    findings.push(finding('config-missing', 'red', 10, {
      title: 'No ~/.claude.json',
      detail: 'The CLI has nowhere to record the session, so every launch starts logged out.',
      fix: 'Run `claude` once and complete `/login`, then re-run this doctor.',
    }));
    return;
  }
  if (config.size === 0) {
    findings.push(finding('config-empty', 'red', 11, {
      title: '~/.claude.json is zero bytes',
      detail: 'A truncated write wiped the file; the account block went with it.',
      fix: 'Restore from ~/.claude.json.backup if present, otherwise re-run `/login`.',
    }));
    return;
  }
  if (config.parseError) {
    findings.push(finding('config-corrupt', 'red', 12, {
      title: '~/.claude.json is not valid JSON',
      detail: `The CLI cannot read the session and falls back to logged out (${config.parseError}).`,
      fix: 'Move the file aside (`mv ~/.claude.json ~/.claude.json.broken`) and re-run `/login`.',
    }));
    return;
  }
  if (config.writable === false) {
    findings.push(finding('config-readonly', 'red', 13, {
      title: '~/.claude.json is not writable',
      detail: 'The login succeeds in memory but cannot be persisted, so it is gone on restart.',
      fix: 'Restore write permission: `chmod u+w ~/.claude.json`.',
    }));
  }
  if (config.hasOAuthAccount === false) {
    findings.push(finding('config-no-account', 'yellow', 20, {
      title: 'No account block in ~/.claude.json',
      detail: 'The config parsed cleanly but carries no oauthAccount, so nothing identifies the session.',
      fix: 'Re-run `/login`; if the block disappears again the writer is being clobbered.',
    }));
  }
  if (isGroupOrWorldAccessible(config.mode)) {
    findings.push(finding('config-permissive', 'yellow', 21, {
      title: '~/.claude.json is readable by other users',
      detail: `Mode ${formatMode(config.mode)} exposes session state beyond your account.`,
      fix: 'Tighten it: `chmod 600 ~/.claude.json`.',
    }));
  }
  const stray = probe.strayFiles ?? [];
  if (stray.length > 0) {
    findings.push(finding('config-stray-writes', 'yellow', 22, {
      title: `${stray.length} leftover config scratch file(s)`,
      detail: `Interrupted atomic writes left ${stray.join(', ')} behind — a sign of concurrent CLI sessions racing on the same config.`,
      fix: 'Safe to delete; close extra `claude` sessions before logging in again.',
      autoFix: true,
      paths: stray,
    }));
  }
}

function inspectOwnership(probe, findings) {
  const uid = probe.uid;
  if (typeof uid !== 'number') return;
  for (const [key, label] of [['config', '~/.claude.json'], ['claudeDir', '~/.claude']]) {
    const target = probe[key];
    if (!target?.exists || typeof target.uid !== 'number') continue;
    if (target.uid !== uid) {
      findings.push(finding(`${key}-foreign-owner`, 'red', 1, {
        title: `${label} is owned by uid ${target.uid}, not you (uid ${uid})`,
        detail: 'This is the signature of a `sudo claude` or `sudo npm i -g` run. The CLI can read the session but cannot rewrite it, so the refreshed token is discarded and the next launch is logged out.',
        fix: `Hand it back: \`sudo chown -R ${uid}:${probe.gid ?? 'staff'} ~/.claude ~/.claude.json\` — then never run \`claude\` under sudo.`,
      }));
    }
  }
}

function inspectCloudSync(probe, findings) {
  for (const [key, label] of [['config', '~/.claude.json'], ['claudeDir', '~/.claude']]) {
    const target = probe[key];
    if (!target?.exists) continue;
    const provider = cloudProviderFor(target.realPath);
    if (!provider) continue;
    findings.push(finding(`${key}-cloud-synced`, 'red', 2, {
      title: `${label} resolves into ${provider}`,
      detail: `${provider} rewrites, evicts, and de-duplicates files under it. Every sync round trip can replace the session the CLI just wrote, which reads exactly as "logged out again".`,
      fix: `Move it back onto local disk (copy the real file out of ${provider}, delete the symlink, restore it at ${target.path ?? label}).`,
    }));
  }
}

function inspectCredentials(probe, findings) {
  const creds = probe.credentialsFile;
  if (probe.platform === 'darwin') {
    findings.push(finding('keychain-manual-check', 'yellow', 30, {
      title: 'Keychain item needs a manual check',
      detail: 'On macOS the session lives in the login keychain as "Claude Code-credentials". This tool never touches the Keychain, so it cannot read it for you.',
      fix: 'Open Keychain Access → login → search "Claude Code-credentials". A missing item after each restart means the login keychain is locking or the item ACL no longer trusts the updated binary; delete the item there and run `/login` once to re-create it with a fresh ACL.',
    }));
    return;
  }
  if (!creds?.exists) {
    findings.push(finding('credentials-missing', 'red', 3, {
      title: 'No ~/.claude/.credentials.json',
      detail: 'On this platform the session is stored in that file. Without it the CLI is logged out by definition.',
      fix: 'Run `/login`. If the file still does not appear, the CLI cannot write to ~/.claude.',
    }));
    return;
  }
  if (isGroupOrWorldAccessible(creds.mode)) {
    findings.push(finding('credentials-permissive', 'red', 4, {
      title: '~/.claude/.credentials.json is readable by other users',
      detail: `Mode ${formatMode(creds.mode)} leaks a live session token to every account on this machine.`,
      fix: 'Tighten it now: `chmod 600 ~/.claude/.credentials.json`.',
    }));
  }
}

function inspectDisk(probe, findings) {
  const free = probe.diskFreeBytes;
  if (typeof free !== 'number') return;
  if (free < MIN_FREE_BYTES) {
    findings.push(finding('disk-full', 'red', 5, {
      title: `Only ${formatBytes(free)} free on the home volume`,
      detail: 'The CLI rewrites its config on every session. When that write fails for space, the login silently fails to persist.',
      fix: 'Free space until at least 200 MB is available, then log in again.',
    }));
  }
}

function inspectEnv(probe, findings) {
  const env = probe.env ?? {};
  for (const [name, why] of AUTH_ENV_VARS) {
    if (!env[name]) continue;
    const sources = (probe.envSources ?? []).filter((s) => s.variable === name);
    const where = sources.length > 0
      ? ` Exported from ${sources.map((s) => `${s.file}:${s.line}`).join(', ')}.`
      : ' Source not found in your shell rc files — check your terminal profile or launchd environment.';
    findings.push(finding(`env-${name}`, 'yellow', 23, {
      title: `${name} is set in the environment`,
      detail: `It ${why}.${where}`,
      fix: `Unset it for interactive shells (remove the export, then \`unset ${name}\`) and log in again.`,
    }));
  }
}

function inspectInstalls(probe, findings) {
  const installs = probe.installs ?? [];
  if (installs.length > 1) {
    findings.push(finding('multiple-installs', 'yellow', 24, {
      title: `${installs.length} \`claude\` binaries on PATH`,
      detail: `Found ${installs.map((i) => i.path).join(', ')}. Different installs disagree about versions, and on macOS each new binary identity has to be re-authorised against the keychain item — which presents as a logout.`,
      fix: 'Keep one install (prefer the native installer) and remove the others.',
    }));
  }
}

function cloudProviderFor(realPath) {
  if (typeof realPath !== 'string') return null;
  for (const [marker, label] of CLOUD_SYNC_MARKERS) {
    if (realPath.includes(`/${marker}/`) || realPath.endsWith(`/${marker}`)) return label;
  }
  return null;
}

function isGroupOrWorldAccessible(mode) {
  return typeof mode === 'number' && (mode & 0o077) !== 0;
}

function formatMode(mode) {
  return typeof mode === 'number' ? (mode & 0o777).toString(8).padStart(3, '0') : 'unknown';
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function finding(id, severity, priority, rest) {
  return { id, severity, priority, autoFix: false, ...rest };
}
