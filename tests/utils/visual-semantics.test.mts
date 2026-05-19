import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  severityColor,
  severityLabel,
  domainColor,
  domainIcon,
  renderSeverityBadge,
  renderDomainBadge,
  type SeverityLevel,
  type DomainKey,
} from '../../src/utils/visual-semantics.js';

// ── severityColor ─────────────────────────────────────────────────────────

describe('severityColor', () => {
  it('level 0 returns var(--severity-0)', () => {
    assert.equal(severityColor(0), 'var(--severity-0)');
  });

  it('level 4 returns var(--severity-4)', () => {
    assert.equal(severityColor(4), 'var(--severity-4)');
  });

  it('all levels produce distinct var references', () => {
    const levels: SeverityLevel[] = [0, 1, 2, 3, 4];
    const colors = levels.map((l) => severityColor(l));
    assert.equal(new Set(colors).size, 5);
  });
});

// ── severityLabel ─────────────────────────────────────────────────────────

describe('severityLabel', () => {
  it('level 0 is Minimal', () => assert.equal(severityLabel(0), 'Minimal'));
  it('level 1 is Low', () => assert.equal(severityLabel(1), 'Low'));
  it('level 2 is Moderate', () => assert.equal(severityLabel(2), 'Moderate'));
  it('level 3 is High', () => assert.equal(severityLabel(3), 'High'));
  it('level 4 is Critical', () => assert.equal(severityLabel(4), 'Critical'));

  it('all levels produce distinct labels', () => {
    const levels: SeverityLevel[] = [0, 1, 2, 3, 4];
    const labels = levels.map((l) => severityLabel(l));
    assert.equal(new Set(labels).size, 5);
  });
});

// ── domainColor ───────────────────────────────────────────────────────────

describe('domainColor', () => {
  it('cyber returns var(--domain-cyber)', () => {
    assert.equal(domainColor('cyber'), 'var(--domain-cyber)');
  });

  it('health returns var(--domain-health)', () => {
    assert.equal(domainColor('health'), 'var(--domain-health)');
  });

  it('financial returns var(--domain-financial)', () => {
    assert.equal(domainColor('financial'), 'var(--domain-financial)');
  });

  it('seismic returns var(--domain-seismic)', () => {
    assert.equal(domainColor('seismic'), 'var(--domain-seismic)');
  });

  it('all 9 domains produce distinct var references', () => {
    const domains: DomainKey[] = ['cyber','weather','geopolitical','maritime','aviation','health','financial','seismic','space'];
    const colors = domains.map((d) => domainColor(d));
    assert.equal(new Set(colors).size, 9);
  });
});

// ── domainIcon ────────────────────────────────────────────────────────────

describe('domainIcon', () => {
  it('returns a non-empty string for cyber', () => {
    assert.ok(domainIcon('cyber').length > 0);
  });

  it('returns a non-empty string for all 9 domains', () => {
    const domains: DomainKey[] = ['cyber','weather','geopolitical','maritime','aviation','health','financial','seismic','space'];
    for (const d of domains) {
      assert.ok(domainIcon(d).length > 0, `${d} icon should be non-empty`);
    }
  });

  it('all 9 domains have distinct icons', () => {
    const domains: DomainKey[] = ['cyber','weather','geopolitical','maritime','aviation','health','financial','seismic','space'];
    const icons = domains.map((d) => domainIcon(d));
    assert.equal(new Set(icons).size, 9);
  });
});

// ── renderSeverityBadge ───────────────────────────────────────────────────

describe('renderSeverityBadge', () => {
  it('contains the severity label for level 0', () => {
    assert.ok(renderSeverityBadge(0).includes('Minimal'));
  });

  it('contains the severity label for level 4', () => {
    assert.ok(renderSeverityBadge(4).includes('Critical'));
  });

  it('contains the CSS variable reference', () => {
    assert.ok(renderSeverityBadge(2).includes('var(--severity-2)'));
  });

  it('uses vs-severity-badge class', () => {
    assert.ok(renderSeverityBadge(1).includes('vs-severity-badge'));
  });

  it('uses custom label when provided', () => {
    assert.ok(renderSeverityBadge(3, 'Danger').includes('Danger'));
    assert.ok(!renderSeverityBadge(3, 'Danger').includes('High'));
  });

  it('escapes HTML in custom label', () => {
    const html = renderSeverityBadge(1, '<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('includes color-mix background', () => {
    assert.ok(renderSeverityBadge(0).includes('color-mix'));
  });
});

// ── renderDomainBadge ─────────────────────────────────────────────────────

describe('renderDomainBadge', () => {
  it('contains the domain name by default', () => {
    assert.ok(renderDomainBadge('health').includes('health'));
  });

  it('uses custom label when provided', () => {
    const html = renderDomainBadge('cyber', 'Cyber Ops');
    assert.ok(html.includes('Cyber Ops'));
    assert.ok(!html.includes('>cyber<'));
  });

  it('contains the CSS variable reference', () => {
    assert.ok(renderDomainBadge('maritime').includes('var(--domain-maritime)'));
  });

  it('uses vs-domain-badge class', () => {
    assert.ok(renderDomainBadge('aviation').includes('vs-domain-badge'));
  });

  it('includes the domain icon', () => {
    const html = renderDomainBadge('space');
    assert.ok(html.includes('🛰️'));
  });

  it('escapes HTML in custom label', () => {
    const html = renderDomainBadge('financial', '<b>Markets</b>');
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;b&gt;'));
  });

  it('includes color-mix background', () => {
    assert.ok(renderDomainBadge('seismic').includes('color-mix'));
  });

  it('renders all 9 domains without throwing', () => {
    const domains: DomainKey[] = ['cyber','weather','geopolitical','maritime','aviation','health','financial','seismic','space'];
    for (const d of domains) {
      assert.ok(renderDomainBadge(d).length > 0);
    }
  });
});
