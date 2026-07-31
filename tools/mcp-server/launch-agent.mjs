import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const MONITOR_LABEL = 'com.bradleybond.crystalball.mcp-monitor';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderMonitorLaunchAgent({
  nodePath,
  runnerPath,
  logPath,
  intervalSeconds = 900,
  stoppedGraceSeconds = intervalSeconds * 2,
}) {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 86_400) {
    throw new Error('Monitor interval must be an integer from 60 to 86400 seconds.');
  }
  if (!Number.isInteger(stoppedGraceSeconds) || stoppedGraceSeconds < 60 || stoppedGraceSeconds > 604_800) {
    throw new Error('Monitor stopped grace must be an integer from 60 to 604800 seconds.');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MONITOR_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(runnerPath)}</string>
    <string>--expected-interval-seconds</string>
    <string>${intervalSeconds}</string>
    <string>--stopped-grace-seconds</string>
    <string>${stoppedGraceSeconds}</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

export function installMonitorLaunchAgent({
  domain,
  execFileSyncFn = execFileSync,
  plist,
  plistPath,
  renameSyncFn = renameSync,
  service,
}) {
  const stagedPath = `${plistPath}.${process.pid}.${Date.now()}.staged`;
  const previousPlist = existsSync(plistPath) ? readFileSync(plistPath, 'utf8') : null;
  let unloaded = false;

  mkdirSync(dirname(plistPath), { recursive: true });
  try {
    writeFileSync(stagedPath, plist, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    execFileSyncFn('plutil', ['-lint', stagedPath], { stdio: 'ignore' });
    try {
      execFileSyncFn('launchctl', ['bootout', service], { stdio: 'ignore' });
      unloaded = true;
    } catch {
      // The job may not be loaded yet.
    }
    try {
      renameSyncFn(stagedPath, plistPath);
      execFileSyncFn('launchctl', ['bootstrap', domain, plistPath]);
    } catch (error) {
      let priorRestored = false;
      if (previousPlist === null) {
        rmSync(plistPath, { force: true });
      } else {
        if (existsSync(stagedPath)) {
          priorRestored = true;
        } else {
          try {
            const rollbackPath = `${stagedPath}.rollback`;
            writeFileSync(rollbackPath, previousPlist, {
              encoding: 'utf8',
              flag: 'wx',
              mode: 0o644,
            });
            renameSyncFn(rollbackPath, plistPath);
            priorRestored = true;
          } catch (rollbackError) {
            error.rollbackError = rollbackError;
          }
        }
        if (unloaded && priorRestored) {
          try {
            execFileSyncFn('launchctl', ['bootstrap', domain, plistPath]);
          } catch (rollbackError) {
            error.rollbackError = rollbackError;
          }
        }
      }
      throw error;
    }
  } finally {
    rmSync(stagedPath, { force: true });
    rmSync(`${stagedPath}.rollback`, { force: true });
  }
}
