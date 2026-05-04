#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.crystalball.little-snitch-exporter';
const DEFAULT_OUTPUT = path.join(userHome(), 'Library/Application Support/Crystal Ball/little-snitch-traffic.json');
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-little-snitch-traffic.mjs');

export function renderLaunchdPlist({
  label,
  nodePath,
  scriptPath,
  outputPath,
  intervalSeconds,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlist(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapePlist(nodePath)}</string>
    <string>${escapePlist(scriptPath)}</string>
    <string>--no-sudo</string>
    <string>--output</string>
    <string>${escapePlist(outputPath)}</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/crystalball-little-snitch-exporter.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/crystalball-little-snitch-exporter.err</string>
</dict>
</plist>
`;
}

async function main(argv) {
  const intervalSeconds = Number(readArg(argv, '--interval') || 300);
  const outputPath = normalizePathArg(readArg(argv, '--output') || DEFAULT_OUTPUT);
  const system = argv.includes('--system');
  const load = argv.includes('--load');
  const plist = renderLaunchdPlist({
    label: LABEL,
    nodePath: process.execPath,
    scriptPath: SCRIPT_PATH,
    outputPath,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds >= 60 ? intervalSeconds : 300,
  });
  const target = system
    ? `/Library/LaunchDaemons/${LABEL}.plist`
    : path.join(os.homedir(), `Library/LaunchAgents/${LABEL}.plist`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, plist, { mode: 0o644 });
  console.log(`Wrote ${target}`);
  if (system) console.log(`Load with: sudo launchctl bootstrap system ${target}`);
  else console.log(`Load with: launchctl bootstrap gui/$(id -u) ${target}`);
  if (load) console.log('Load requested; run the printed launchctl command from a trusted shell.');
}

function escapePlist(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function normalizePathArg(value) {
  const normalized = String(value).replace(/[\r\n\t]+\s*/g, '').trim();
  if (!normalized.startsWith('/')) throw new Error(`Expected absolute path, got ${normalized}`);
  return normalized;
}

function userHome() {
  if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') return path.join('/Users', process.env.SUDO_USER);
  return os.homedir();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
