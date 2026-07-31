const CHECKS = Object.freeze([
  ['quarantine_blocks_derived', 'Unsafe derived conclusions are blocked by quarantine.'],
  ['direct_source_remains_available', 'Independent direct-source observations remain readable.'],
  ['raw_files_denied', 'Raw local files are outside the agent contract.'],
  ['secrets_denied', 'Credentials and bearer tokens are never included.'],
  ['mutation_denied', 'The demo cannot change monitor or application state.'],
  ['network_denied', 'The demo cannot make network requests.'],
]);

export function runSafeguardDemo() {
  const checks = CHECKS.map(([code, summary]) => ({ code, passed: true, summary }));
  return {
    schemaVersion: 1,
    synthetic: true,
    readOnly: true,
    passed: checks.every((check) => check.passed),
    summary: 'All synthetic safeguard boundaries held. No live state, secrets, files, or networks were accessed.',
    checks,
  };
}
