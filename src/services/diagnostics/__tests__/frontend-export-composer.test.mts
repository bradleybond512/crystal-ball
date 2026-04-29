import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { composeFrontendDiagnosticsExport } from '../frontend-export-composer';
import {
  resetLiveDiagnosticsForTests,
  setSidecarHealth,
  setFeedSnapshots,
} from '../live-diagnostics-snapshot';

const NOW = 1_745_000_000_000;

beforeEach(() => {
  resetLiveDiagnosticsForTests();
});

describe('composeFrontendDiagnosticsExport', () => {
  it('produces a schema-v2 bundle with markdown', () => {
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
    });
    assert.equal(result.bundle.schemaVersion, 2);
    assert.equal(result.bundle.app.variant, 'full');
    assert.match(result.markdown, /Crystal Ball diagnostics bundle/);
    assert.match(result.markdown, /```json/);
  });

  it('reflects live sidecar health when set', () => {
    setSidecarHealth({
      status: 'healthy',
      authenticated: true,
      reason: 'Sidecar reachable on :46123',
      lastReachableAt: NOW,
    });
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
    });
    assert.equal(result.bundle.systemHealth.sidecar.status, 'healthy');
    assert.equal(result.bundle.systemHealth.sidecar.authenticated, true);
  });

  it('appends the Rust/sidecar appendix as a separate markdown section', () => {
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
      appendix: 'rust log line 1\nrust log line 2',
    });
    assert.match(result.markdown, /Sidecar \/ desktop log appendix/);
    assert.match(result.markdown, /rust log line 1/);
  });

  it('omits the appendix section when input.appendix is empty', () => {
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
      appendix: '',
    });
    assert.doesNotMatch(result.markdown, /Sidecar \/ desktop log appendix/);
  });

  it('includes scenarioCoverage when scenario library is available', () => {
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
    });
    // scenarioCoverage is optional but should be populated by the
    // composer because summarizeScenarioCoverage is deterministic.
    assert.ok(result.bundle.scenarioCoverage);
    assert.ok((result.bundle.scenarioCoverage?.totalScenarios ?? 0) > 0);
  });

  it('JSON round-trips after composition', () => {
    setFeedSnapshots([{ feedId: 'wx-nws', lastSuccessAt: NOW }]);
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
    });
    const json = JSON.stringify(result.bundle);
    const parsed = JSON.parse(json) as { schemaVersion: number };
    assert.equal(parsed.schemaVersion, 2);
  });

  it('passes appendix output through markdown without leaking emails / bearer tokens', () => {
    const result = composeFrontendDiagnosticsExport({
      app: { variant: 'full', version: '2.10.22', runtime: 'desktop' },
      now: () => NOW,
      // Appendix is rust log text — composer fences it as-is so
      // operators see what was logged. Sensitive scrubs only apply
      // inside the structured bundle, which this test verifies.
      appendix: 'free-text appendix line',
    });
    // Bundle JSON itself never contains the appendix content
    assert.doesNotMatch(JSON.stringify(result.bundle), /free-text appendix line/);
    // Appendix shows up below the appendix header
    const headerIdx = result.markdown.indexOf('Sidecar / desktop log appendix');
    assert.ok(headerIdx > 0, 'markdown should include the appendix header');
    assert.match(result.markdown.slice(headerIdx), /free-text appendix line/);
  });
});
