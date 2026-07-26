export function latestSessionLines(lines) {
  const sessionStart = lines.findLastIndex((line) => line.includes('SESSION START'));
  return sessionStart === -1 ? lines : lines.slice(sessionStart);
}

export function parseInjectedKeyCount(lines) {
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = lines[index]?.match(/injected (\d+)(?:\/\d+)? keychain secrets/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

export function unrecoveredHeartbeatStaleAge(lines) {
  const staleIndex = lines.findLastIndex((line) => line.includes('sidecar heartbeat stale'));
  if (staleIndex === -1) return null;

  const recoveredIndex = lines.findLastIndex((line) => line.includes('sidecar heartbeat recovered'));
  if (recoveredIndex > staleIndex) return null;

  const age = lines[staleIndex]?.match(/age=(\d+)s/)?.[1];
  return age ? Number.parseInt(age, 10) : null;
}
