/**
 * E2E diagnostics privacy canary test — per
 * docs/CLAUDE_EXTRA_BUG_SECURITY_CHECKS_2026-04-29.md Priority 1.
 *
 * The export bundle has unit-level redaction tests, but the real
 * Cmd+Shift+D path composes:
 *
 *   - frontend bundle (export-bundle)
 *   - + the Rust copy_diagnostics text appendix (logs + /api/diag)
 *   - + a tail of the breadcrumb ring
 *
 * A new section added to ANY of those layers becomes part of the
 * privacy boundary. This test injects canary values across every
 * surface the composer touches and asserts none survive serialization.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { composeFrontendDiagnosticsExport } from '../frontend-export-composer';
import {
  resetLiveDiagnosticsForTests,
  setFeedSnapshots,
  setSidecarHealth,
} from '../live-diagnostics-snapshot';
import { resetQualityDebtForTests } from '@/services/quality/quality-debt-state';

const NOW = 1_745_000_000_000;

const CANARIES = {
  email: 'leak-canary+test@example.invalid',
  bearer: 'Bearer aaaabbbbccccddddeeeeffff00001111',
  longHex: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  apiKeyPrefix: 'sk-canarycanarycanarycanarycanary12345',
  bearerSnake: 'Bearer xxxxYYYYzzzzAAAAbbbbCCCCddddEEEEffff',
  phone: '+1 (555) 867-5309',
  password: 'p@ssw0rd-canary-do-not-leak',
  authzHeader: 'authorization: Bearer 00000000111111112222222233333333',
  exactLat: 41.6105234,
  exactLng: -86.7234567,
};

beforeEach(() => {
  resetLiveDiagnosticsForTests();
  resetQualityDebtForTests();
});

function buildExportWithCanaries(): { markdown: string; bundleJson: string } {
  const appendix = [
    `[INFO] connecting to https://api.example.com?key=${CANARIES.apiKeyPrefix}`,
    `[WARN] auth header ${CANARIES.authzHeader}`,
    `[ERROR] retry from ${CANARIES.email}`,
    `[INFO] callback phone ${CANARIES.phone}`,
    `[INFO] location ping ${CANARIES.exactLat},${CANARIES.exactLng}`,
    `[DEBUG] response ${CANARIES.longHex}`,
    `[DEBUG] header ${CANARIES.bearer}`,
  ].join('\n');

  setFeedSnapshots([
    {
      feedId: 'wx-nws',
      lastSuccessAt: NOW,
      lastError: `auth failed for ${CANARIES.email} (${CANARIES.bearerSnake})`,
    },
  ]);

  setSidecarHealth({
    status: 'degraded',
    authenticated: false,
    reason: `last seen ${CANARIES.email}; password=${CANARIES.password}`,
  });

  const result = composeFrontendDiagnosticsExport({
    app: { variant: 'full', version: '2.10.21', runtime: 'desktop' },
    env: { locale: 'en-US', timezone: 'America/Indiana/Indianapolis', isMacOs: true },
    appendix,
    now: () => NOW,
  });

  return {
    markdown: result.markdown,
    bundleJson: JSON.stringify(result.bundle),
  };
}

describe('Diagnostics privacy canary — bundle JSON', () => {
  it('redacts emails inside structured fields', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /leak-canary\+test@example\.invalid/);
  });

  it('redacts bearer tokens in free-text reason / lastError fields', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /Bearer\s+aaaabbbbccccddddeeeeffff00001111/);
    assert.doesNotMatch(bundleJson, /Bearer\s+xxxxYYYYzzzzAAAAbbbbCCCCddddEEEEffff/);
  });

  it('redacts long-hex blobs that look like tokens', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/);
  });

  it('redacts password values appearing in free text', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /p@ssw0rd-canary-do-not-leak/);
  });

  it('redacts phone numbers in free-text fields', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /\+?1\s*\(?555\)?[\s.\-]+867[\s.\-]+5309/);
  });

  it('redacts high-precision coordinates in free-text fields', () => {
    const { bundleJson } = buildExportWithCanaries();
    assert.doesNotMatch(bundleJson, /41\.6105/);
    assert.doesNotMatch(bundleJson, /86\.7234/);
  });
});

describe('Diagnostics privacy canary — final markdown payload', () => {
  it('keeps the structured bundle scrubbed even with the appendix attached', () => {
    const { markdown } = buildExportWithCanaries();
    const jsonBlockMatch = /```json\n([\s\S]*?)```/.exec(markdown);
    assert.ok(jsonBlockMatch, 'expected a fenced json block in the markdown payload');
    const jsonOnly = jsonBlockMatch[1] ?? '';

    assert.doesNotMatch(jsonOnly, /leak-canary\+test@example\.invalid/);
    assert.doesNotMatch(jsonOnly, /Bearer\s+aaaabbbb/);
    assert.doesNotMatch(jsonOnly, /Bearer\s+xxxxYYYY/);
    assert.doesNotMatch(jsonOnly, /a1b2c3d4e5f6/);
    assert.doesNotMatch(jsonOnly, /p@ssw0rd-canary/);
    assert.doesNotMatch(jsonOnly, /41\.6105/);
    assert.doesNotMatch(jsonOnly, /86\.7234/);
  });

  it('the bundle remains valid JSON after redaction', () => {
    const { markdown } = buildExportWithCanaries();
    const jsonBlockMatch = /```json\n([\s\S]*?)```/.exec(markdown);
    const jsonOnly = jsonBlockMatch?.[1] ?? '';
    assert.doesNotThrow(() => JSON.parse(jsonOnly));
  });
});

describe('Diagnostics privacy canary — schema completeness gate', () => {
  it('every top-level bundle field is either redacted or a known-safe primitive', () => {
    const KNOWN_TOP_LEVEL_FIELDS = new Set([
      'schemaVersion',
      'generatedAt',
      'app',
      'env',
      'systemHealth',
      'notificationSummary',
      'notificationTraces',
      'recentEvents',
      'selfTest',
      'failurePrediction',
      'qualityDebt',
      'trustBudget',
      'improvementPlan',
      'scenarioCoverage',
      'truncations',
      // Phase-2 diagnostic sections. Classification (confirmed against
      // frontend-export-composer + export-bundle):
      //  - Safe primitives only (ids / enums / numbers / timestamps, no free text):
      'missionState',     // { state, staleFeedCount, criticalStaleFeedCount }
      'feedHealth',       // { id, name(static catalog), status, lastUpdateIso }
      'algorithmState',   // { algorithmId, domain, graded, hitRate, ... } — numbers
      'systemInfo',       // { appVersion, buildHash, uptimeMs, memoryUsedBytes }
      'algorithmTrace',   // ids + numbers; evidence summaries → redactString
      //  - Carry free text, all run through redactString in export-bundle:
      'panelHealthSummary', // entries[].reason (panel lastError) redacted
      'situations',         // name + summary + tags redacted
      'correlations',       // title redacted
    ]);
    const { bundleJson } = buildExportWithCanaries();
    const bundle = JSON.parse(bundleJson) as Record<string, unknown>;
    const unknown = Object.keys(bundle).filter((k) => !KNOWN_TOP_LEVEL_FIELDS.has(k));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown top-level export bundle fields not classified for privacy: ${unknown.join(', ')}.\n` +
          `Add each to KNOWN_TOP_LEVEL_FIELDS after confirming it flows through redaction.`,
      );
    }
  });
});
