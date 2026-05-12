/**
 * Tests for the severity-badge utility (src/utils/severity-badge.ts).
 *
 * Inlines the pure logic because the test runner can't import TypeScript
 * directly. All assertions are structural: CSS var strings, HTML shape,
 * escaping behaviour.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Inline the pure logic (mirrors severity-badge.ts) ────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_LABEL = {
  critical: 'Critical', high: 'High', medium: 'Medium',
  low: 'Low', info: 'Info', ok: 'OK',
};

const DOMAIN_LABEL = {
  earthquake: 'Earthquake', wildfire: 'Wildfire', aviation: 'Aviation',
  maritime: 'Maritime', weather: 'Weather', cyber: 'Cyber',
  space: 'Space', biosurveillance: 'Biosurveillance',
  geopolitical: 'Geopolitical', infrastructure: 'Infrastructure',
};

const DOMAIN_ICON_MAP = {
  earthquake: '🌐', wildfire: '🔥', aviation: '✈️', maritime: '🚢',
  weather: '⛈️', cyber: '💻', space: '🛰️', biosurveillance: '🧬',
  geopolitical: '🗺️', infrastructure: '🏗️',
};

function severityToColor(severity) {
  return `var(--severity-${severity})`;
}

function severityBadge(severity, label) {
  const displayLabel = label ?? SEVERITY_LABEL[severity];
  const color = severityToColor(severity);
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="severity-badge" style="color:${color};background:${bg};">${escapeHtml(displayLabel)}</span>`;
}

function domainBadge(domain, label) {
  const displayLabel = label ?? DOMAIN_LABEL[domain];
  const color = `var(--domain-${domain})`;
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="domain-badge" style="color:${color};background:${bg};">${escapeHtml(displayLabel)}</span>`;
}

function domainIcon(domain) {
  return DOMAIN_ICON_MAP[domain] ?? '●';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('severityToColor', () => {
  it('returns var(--severity-critical) for critical', () => {
    assert.equal(severityToColor('critical'), 'var(--severity-critical)');
  });

  it('returns var(--severity-ok) for ok', () => {
    assert.equal(severityToColor('ok'), 'var(--severity-ok)');
  });

  it('returns var(--severity-info) for info', () => {
    assert.equal(severityToColor('info'), 'var(--severity-info)');
  });
});

describe('severityBadge', () => {
  it('uses the severity CSS var for color', () => {
    const html = severityBadge('high');
    assert.ok(html.includes('var(--severity-high)'), `expected CSS var in: ${html}`);
  });

  it('uses color-mix for the background', () => {
    const html = severityBadge('medium');
    assert.ok(html.includes('color-mix(in srgb, var(--severity-medium) 15%, transparent)'), html);
  });

  it('renders the default label', () => {
    const html = severityBadge('critical');
    assert.ok(html.includes('Critical'), html);
  });

  it('renders a custom label when provided', () => {
    const html = severityBadge('high', 'URGENT');
    assert.ok(html.includes('URGENT'), html);
  });

  it('HTML-escapes the custom label', () => {
    const html = severityBadge('low', '<script>');
    assert.ok(!html.includes('<script>'), 'raw <script> should not appear');
    assert.ok(html.includes('&lt;script&gt;'), html);
  });

  it('has class severity-badge', () => {
    const html = severityBadge('info');
    assert.ok(html.includes('class="severity-badge"'), html);
  });

  it('produces valid span element', () => {
    const html = severityBadge('ok');
    assert.ok(html.startsWith('<span'), html);
    assert.ok(html.endsWith('</span>'), html);
  });
});

describe('domainBadge', () => {
  it('uses var(--domain-wildfire) for wildfire', () => {
    const html = domainBadge('wildfire');
    assert.ok(html.includes('var(--domain-wildfire)'), html);
  });

  it('uses color-mix for background', () => {
    const html = domainBadge('cyber');
    assert.ok(html.includes('color-mix(in srgb, var(--domain-cyber) 15%, transparent)'), html);
  });

  it('renders the default domain label', () => {
    const html = domainBadge('earthquake');
    assert.ok(html.includes('Earthquake'), html);
  });

  it('renders a custom label when provided', () => {
    const html = domainBadge('aviation', 'ATC');
    assert.ok(html.includes('ATC'), html);
  });

  it('HTML-escapes the custom domain label', () => {
    const html = domainBadge('space', '<b>bold</b>');
    assert.ok(!html.includes('<b>'), 'raw <b> should be escaped');
    assert.ok(html.includes('&lt;b&gt;'), html);
  });

  it('has class domain-badge', () => {
    const html = domainBadge('maritime');
    assert.ok(html.includes('class="domain-badge"'), html);
  });
});

describe('domainIcon', () => {
  it('returns the correct emoji for wildfire', () => {
    assert.equal(domainIcon('wildfire'), '🔥');
  });

  it('returns the correct emoji for aviation', () => {
    assert.equal(domainIcon('aviation'), '✈️');
  });

  it('returns fallback ● for unknown domain', () => {
    assert.equal(domainIcon('unknown_domain'), '●');
  });

  it('returns correct emoji for cyber', () => {
    assert.equal(domainIcon('cyber'), '💻');
  });
});
