export const SERVER_NAME = 'crystalball';
export const SERVER_VERSION = '0.3.0';
export const SKILL_CONTRACT_VERSION = 1;
export const EVIDENCE_PACKET_VERSION = 1;

export const COMPATIBILITY = Object.freeze({
  protocol: '2025-03-26',
  server: Object.freeze({ current: SERVER_VERSION, testedMinor: '0.3', maxExclusive: '1.0.0' }),
  skillContract: Object.freeze({ current: SKILL_CONTRACT_VERSION, minimum: 1, maximum: 1 }),
  evidencePacket: Object.freeze({ current: EVIDENCE_PACKET_VERSION }),
});

export function compatibilityVerdict({ serverVersion, skillContractVersion } = {}) {
  if (typeof serverVersion !== 'string' || !Number.isInteger(skillContractVersion)) {
    return {
      verdict: 'unknown',
      code: 'version_missing',
      summary: 'Compatibility cannot be confirmed because version information is missing.',
    };
  }
  const version = parseVersion(serverVersion);
  if (!version || version.major >= 1 || skillContractVersion < 1 || skillContractVersion > 1) {
    return {
      verdict: 'incompatible',
      code: 'version_out_of_range',
      summary: 'The installed agent contract is outside this Crystal Ball compatibility range.',
    };
  }
  if (`${version.major}.${version.minor}` !== COMPATIBILITY.server.testedMinor) {
    return {
      verdict: 'warning',
      code: 'version_untested',
      summary: 'The installed versions may work, but this combination has not been tested.',
    };
  }
  return {
    verdict: 'compatible',
    code: 'version_supported',
    summary: 'Desktop, MCP, and skill contract versions are compatible.',
  };
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
