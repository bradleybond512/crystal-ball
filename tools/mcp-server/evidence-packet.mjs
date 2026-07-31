import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  COMPATIBILITY,
  EVIDENCE_PACKET_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  SKILL_CONTRACT_VERSION,
  compatibilityVerdict,
} from './server-meta.mjs';
import { TOOL_CATALOG } from './tool-registry.mjs';

const MAX_INPUT_BYTES = 1_000_000;
const SENSITIVE_KEYS = /(?:authorization|bearer|cookie|credential|password|secret|token|api[_-]?key|private[_-]?key)/i;

export function buildEvidencePacket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Evidence input must be an object.');
  }
  const inputSize = Buffer.byteLength(JSON.stringify(input));
  if (inputSize > MAX_INPUT_BYTES) throw new RangeError('Evidence input exceeds the size limit.');
  const generatedAt = new Date(input.generatedAt);
  if (!input.generatedAt || Number.isNaN(generatedAt.valueOf())) {
    throw new TypeError('generatedAt must be a valid ISO timestamp.');
  }
  const result = redactValue(input.result ?? {});
  const sources = Array.isArray(result.sources)
    ? [...new Set(result.sources.filter((value) => typeof value === 'string'))].sort()
    : [];
  const query = redactValue(input.query ?? {});
  const canonicalPermission = typeof query.tool === 'string'
    ? TOOL_CATALOG[query.tool]?.permission ?? null
    : null;
  const payload = {
    schema: 'crystalball.evidence-packet',
    schemaVersion: EVIDENCE_PACKET_VERSION,
    generatedAt: generatedAt.toISOString(),
    producer: {
      name: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      skillContractVersion: SKILL_CONTRACT_VERSION,
      protocolVersion: COMPATIBILITY.protocol,
    },
    compatibility: compatibilityVerdict({
      serverVersion: SERVER_VERSION,
      skillContractVersion: SKILL_CONTRACT_VERSION,
    }),
    query: {
      ...query,
      permission: canonicalPermission,
    },
    observation: {
      summary: typeof result.summary === 'string' ? result.summary : '',
      timestamp: validDateOrNull(result.timestamp),
      healthy: typeof result.healthy === 'boolean' ? result.healthy : null,
      data: result.data ?? null,
      warnings: stringArray(result.warnings),
    },
    provenance: {
      directSources: sources,
      sourceType: sources.length > 0 ? 'direct-observation' : 'unspecified',
    },
    freshness: {
      observedAt: validDateOrNull(result.timestamp),
      exportedAt: generatedAt.toISOString(),
    },
    capabilities: {
      missing: stringArray(input.capabilities?.missing).sort(),
    },
    safeguards: {
      algorithmVersions: redactValue(input.algorithms?.versions ?? {}),
      quarantinedAlgorithms: stringArray(input.algorithms?.quarantined).sort(),
    },
  };
  const digest = createHash('sha256').update(canonicalStringify(payload)).digest('hex');
  return { ...payload, integrity: { algorithm: 'sha256', digest } };
}

export async function writeEvidencePacket(target, packet) {
  if (typeof target !== 'string' || target.length === 0) throw new TypeError('Output path is required.');
  const directory = dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function verifyEvidencePacket(packet) {
  if (!packet || typeof packet !== 'object' || packet.schemaVersion !== EVIDENCE_PACKET_VERSION) {
    return false;
  }
  const { integrity, ...payload } = packet;
  if (integrity?.algorithm !== 'sha256' || typeof integrity.digest !== 'string') return false;
  const expected = createHash('sha256').update(canonicalStringify(payload)).digest('hex');
  return expected === integrity.digest;
}

export function canonicalStringify(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function redactValue(value) {
  if (Array.isArray(value)) return value.map((child) => (
    child === undefined ? null : redactValue(child)
  ));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, child]) => !SENSITIVE_KEYS.test(key) && child !== undefined)
      .map(([key, child]) => [key, redactValue(child)]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[USER]')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
}

function validDateOrNull(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
