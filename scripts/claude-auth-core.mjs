// Pure analysis of metadata collected by the read-only Claude login doctor.
const SEVERITY_RANK = { red: 0, yellow: 1 };
export const AUTH_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
const CLOUD_SYNC_MARKERS = [
  ['Library/Mobile Documents', 'iCloud Drive'], ['Dropbox', 'Dropbox'],
  ['Google Drive', 'Google Drive'], ['GoogleDrive', 'Google Drive'], ['OneDrive', 'OneDrive'],
];

export function isConfigScratchFile(name) {
  return typeof name === 'string' && /^\.claude\.json\.(tmp[\w.-]*|lock|swp)$/.test(name);
}

export function statusFromFindings(findings) {
  if (findings.some((f) => f.severity === 'red')) return 'red';
  if (findings.some((f) => f.severity === 'yellow')) return 'yellow';
  return 'ok';
}

export function buildClaudeAuthReport(probe) {
  const findings = [];
  const add = (id, severity, priority, title, detail, fix) => findings.push({ id, severity, priority, title, detail, fix });
  inspectConfig(probe.config ?? {}, add);
  const scratchCount = probe.strayFiles?.length ?? 0;
  if (scratchCount) add('config-stray-writes', 'yellow', 22,
    `${scratchCount} config scratch file(s) present`,
    'Their ownership and activity have not been assessed. Presence alone does not establish an interrupted write or a concurrent writer.',
    'Inspect the relevant processes and file metadata before deciding whether any action is appropriate.');

  inspectOwnershipAndSync(probe, add);

  if (probe.platform === 'darwin') {
    add('keychain-manual-check', 'yellow', 30, 'Keychain was not inspected',
      'This diagnostic does not access Keychain or verify a stored session.',
      'Consult Claude Code authentication documentation or support for an authentication issue.');
  } else if (probe.credentialsFile?.readError) {
    add('credentials-unreadable', 'red', 3, 'Credential file metadata is unavailable',
      'The filesystem inspection could not complete. Credential contents were not read.',
      'Inspect access to ~/.claude/.credentials.json without changing it.');
  } else if (!probe.credentialsFile?.exists) {
    add('credentials-missing', 'red', 3, 'No ~/.claude/.credentials.json observed',
      'This expected file was not found. Other authentication modes have not been assessed.',
      'Check which authentication mode and configuration location this installation uses.');
  } else if (isGroupOrWorldAccessible(probe.credentialsFile.mode)) {
    add('credentials-permissive', 'red', 4, 'Credential file has group or other permission bits',
      'File metadata permits access beyond owner-only mode; effective access and credential validity have not been assessed.',
      'Inspect file permissions and account access before choosing a repair.');
  }

  const free = probe.diskFreeBytes;
  if (typeof free === 'number' && free < 200 * 1024 * 1024) {
    add('disk-full', 'red', 5, `Only ${Math.round(free / 1024 / 1024)} MB free on the home volume`,
      'Low available space can interfere with writes. This diagnostic has not attempted a write.',
      'Inspect storage usage and available space.');
  }
  inspectEnv(probe, add);
  if ((probe.installs?.length ?? 0) > 1) {
    add('multiple-installs', 'yellow', 24, `${probe.installs.length} distinct executable paths named claude`,
      'Executable file paths were observed on PATH. Versions and authentication behavior were not checked.',
      'Inspect which installation your terminal selects and consult its documentation.');
  }
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.priority - b.priority);
  return { status: statusFromFindings(findings), platform: probe.platform ?? 'unknown', checked: probe.configPath ?? null, findings };
}

function inspectConfig(config, add) {
  if (config.readError) {
    add('config-unreadable', 'red', 10, '~/.claude.json could not be read',
      'The filesystem inspection did not yield readable configuration data. No configuration content is included.',
      'Inspect file type and access permissions without modifying the file.');
    return;
  }
  if (!config.exists) {
    add('config-missing', 'red', 10, 'No ~/.claude.json observed',
      'The expected configuration path was not found. A different configuration location or authentication mode may be in use.',
      'Check the configuration location used by your installation.');
    return;
  }
  if (config.size === 0) {
    add('config-empty', 'red', 11, '~/.claude.json is zero bytes',
      'The observed file is empty. The cause and session state have not been determined.',
      'Inspect available file history and consult support before making changes.');
    return;
  }
  if (config.parseError) {
    add('config-corrupt', 'red', 12, '~/.claude.json is not valid JSON',
      'The configuration could not be parsed as JSON. No configuration content is included.',
      'Inspect the configuration locally without sharing credentials or replacing the file.');
    return;
  }
  if (config.writable === false) add('config-readonly', 'red', 13, '~/.claude.json is not writable',
    'The access check did not grant write access. No write was attempted.',
    'Inspect the file permissions and ownership before considering changes.');
  if (config.hasOAuthAccount === false) add('config-no-account', 'yellow', 20, 'No account block in ~/.claude.json',
    'The parsed configuration has no truthy oauthAccount field. This does not establish session validity.',
    'Check the authentication mode and configuration location expected by this installation.');
  if (isGroupOrWorldAccessible(config.mode)) add('config-permissive', 'yellow', 21, 'Configuration has group or other permission bits',
    'File metadata permits access beyond owner-only mode; effective access has not been assessed.',
    'Inspect permissions and account access before considering changes.');
}

function cloudProviderFor(realPath) {
  if (typeof realPath !== 'string') return null;
  return CLOUD_SYNC_MARKERS.find(([marker]) => realPath.includes(`/${marker}/`) || realPath.endsWith(`/${marker}`))?.[1] ?? null;
}

function isGroupOrWorldAccessible(mode) {
  return typeof mode === 'number' && (mode & 0o077) !== 0;
}

function inspectOwnershipAndSync(probe, add) {
  for (const [key, label] of [['config', '~/.claude.json'], ['claudeDir', '~/.claude']]) {
    const target = probe[key];
    if (!target?.exists) continue;
    if (typeof probe.uid === 'number' && typeof target.uid === 'number' && target.uid !== probe.uid) {
      add(`${key}-foreign-owner`, 'red', 1, `${label} has a different owner`,
        'The filesystem owner differs from the current user. This does not establish how it happened or whether authentication works.',
        'Inspect ownership and access with the account administrator before considering a repair.');
    }
    const provider = cloudProviderFor(target.realPath);
    if (provider) add(`${key}-cloud-synced`, 'red', 2, `${label} resolves into ${provider}`,
      'The resolved path matches a known sync-directory name. Sync activity and effects on authentication have not been verified.',
      'Inspect the sync settings and file history without changing or relocating the configuration.');
  }

}

function inspectEnv(probe, add) {
  for (const name of AUTH_ENV_VARS) {
    if (!probe.env?.[name]) continue;
    const sources = (probe.envSources ?? []).filter((s) => s.variable === name);
    const locations = sources.map((s) => `${s.file}:${s.line}`).join(', ');
    const where = sources.length ? ` Matching assignments observed at ${locations}.` : ' Source not found in the inspected shell files.';
    add(`env-${name}`, 'yellow', 23, `${name} is set in the environment`,
      `This setting can affect authentication or endpoint selection; its value was not retained.${where}`,
      'Inspect whether this setting is intentional for your authentication mode. Shell files were read as text and were not executed.');
  }
}
