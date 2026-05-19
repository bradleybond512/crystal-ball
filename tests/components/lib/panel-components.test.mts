import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createPanelHeader,
  createCard,
  createBadge,
  createTimeline,
  createStatusIndicator,
  createStatRow,
  createEmptyState,
  createErrorState,
} from '../../../src/components/lib/panel-components.ts';

// ── createPanelHeader ─────────────────────────────────────────────────────────

describe('createPanelHeader', () => {
  it('renders title', () => {
    const html = createPanelHeader('My Panel');
    assert.ok(html.includes('My Panel'), 'should include title');
  });

  it('escapes title HTML', () => {
    const html = createPanelHeader('<script>xss</script>');
    assert.ok(!html.includes('<script>'), 'should escape title');
    assert.ok(html.includes('&lt;script&gt;'), 'should have escaped form');
  });

  it('omits subtitle when not provided', () => {
    const html = createPanelHeader('Title');
    assert.ok(!html.includes('font-size:11px;opacity:0.65'), 'should not include subtitle block');
  });

  it('renders subtitle when provided', () => {
    const html = createPanelHeader('Title', 'Sub info');
    assert.ok(html.includes('Sub info'), 'should include subtitle');
  });

  it('escapes subtitle HTML', () => {
    const html = createPanelHeader('T', '<b>bad</b>');
    assert.ok(!html.includes('<b>'), 'should escape subtitle');
    assert.ok(html.includes('&lt;b&gt;'), 'should have escaped form');
  });

  it('omits badge when not provided', () => {
    const html = createPanelHeader('Title');
    assert.ok(!html.includes('border-radius:10px'), 'should not include badge span');
  });

  it('renders badge when provided', () => {
    const html = createPanelHeader('Title', undefined, 'LIVE');
    assert.ok(html.includes('LIVE'), 'should include badge text');
  });

  it('escapes badge HTML', () => {
    const html = createPanelHeader('T', undefined, '<b>');
    assert.ok(!html.includes('<b>'), 'should escape badge');
  });

  it('returns a string', () => {
    assert.equal(typeof createPanelHeader('X'), 'string');
  });
});

// ── createCard ────────────────────────────────────────────────────────────────

describe('createCard', () => {
  it('renders title and body', () => {
    const html = createCard('Card Title', '<strong>body</strong>');
    assert.ok(html.includes('Card Title'), 'should include title');
    assert.ok(html.includes('<strong>body</strong>'), 'body is rendered verbatim (trusted HTML)');
  });

  it('escapes title', () => {
    const html = createCard('<img src=x>', 'body');
    assert.ok(!html.includes('<img'), 'should escape title');
  });

  it('uses severity color when severity provided', () => {
    const html = createCard('T', 'b', 4);
    assert.ok(html.includes('severity-critical'), 'severity 4 → critical color');
  });

  it('uses ok color for severity 0', () => {
    const html = createCard('T', 'b', 0);
    assert.ok(html.includes('severity-ok'), 'severity 0 → ok color');
  });

  it('uses default border when severity omitted', () => {
    const html = createCard('T', 'b');
    assert.ok(html.includes('rgba(255,255,255,0.1)'), 'should use default border');
  });

  it('renders footer when provided', () => {
    const html = createCard('T', 'b', undefined, 'Footer text');
    assert.ok(html.includes('Footer text'), 'should include footer');
  });

  it('escapes footer', () => {
    const html = createCard('T', 'b', undefined, '<script>');
    assert.ok(!html.includes('<script>'), 'should escape footer');
  });

  it('omits footer block when not provided', () => {
    const html = createCard('T', 'b');
    assert.ok(!html.includes('border-top:1px solid'), 'should not include footer separator');
  });

  it('severity 1 → low color', () => {
    const html = createCard('T', 'b', 1);
    assert.ok(html.includes('severity-low'), 'severity 1 → low');
  });

  it('severity 2 → medium color', () => {
    const html = createCard('T', 'b', 2);
    assert.ok(html.includes('severity-medium'), 'severity 2 → medium');
  });

  it('severity 3 → high color', () => {
    const html = createCard('T', 'b', 3);
    assert.ok(html.includes('severity-high'), 'severity 3 → high');
  });
});

// ── createBadge ───────────────────────────────────────────────────────────────

describe('createBadge', () => {
  it('renders label text', () => {
    const html = createBadge('Active', 'status', 'ok');
    assert.ok(html.includes('Active'), 'should include label');
  });

  it('escapes label', () => {
    const html = createBadge('<xss>', 'status', 'ok');
    assert.ok(!html.includes('<xss>'), 'should escape label');
    assert.ok(html.includes('&lt;xss&gt;'), 'escaped form present');
  });

  it('severity variant with numeric value → severity CSS var', () => {
    const html = createBadge('High', 'severity', 3);
    assert.ok(html.includes('severity-high'), 'numeric 3 → high');
  });

  it('severity variant with string value → CSS var passthrough', () => {
    const html = createBadge('Crit', 'severity', 'critical');
    assert.ok(html.includes('severity-critical'), 'string value used in var()');
  });

  it('domain variant uses domain CSS var', () => {
    const html = createBadge('Space', 'domain', 'space');
    assert.ok(html.includes('domain-space'), 'should use domain-space var');
  });

  it('status variant uses severity CSS var', () => {
    const html = createBadge('OK', 'status', 'ok');
    assert.ok(html.includes('severity-ok'), 'status → severity var');
  });

  it('returns span element', () => {
    const html = createBadge('X', 'status', 'ok');
    assert.ok(html.startsWith('<span'), 'should be a span');
  });
});

// ── createTimeline ────────────────────────────────────────────────────────────

describe('createTimeline', () => {
  it('renders empty state when no events', () => {
    const html = createTimeline([]);
    assert.ok(html.includes('No events'), 'should show empty message');
  });

  it('renders event label', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'M6.2 Quake', severity: 3 }]);
    assert.ok(html.includes('M6.2 Quake'), 'should include label');
  });

  it('escapes event label', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: '<b>xss</b>', severity: 1 }]);
    assert.ok(!html.includes('<b>xss</b>'), 'should escape label');
    assert.ok(html.includes('&lt;b&gt;'), 'escaped form present');
  });

  it('renders dot with correct severity color', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'Event', severity: 4 }]);
    assert.ok(html.includes('severity-critical'), 'severity 4 → critical dot');
  });

  it('renders detail when provided', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'Ev', severity: 1, detail: 'Extra info' }]);
    assert.ok(html.includes('Extra info'), 'should include detail');
  });

  it('escapes detail', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'Ev', severity: 1, detail: '<script>' }]);
    assert.ok(!html.includes('<script>'), 'should escape detail');
  });

  it('omits detail block when not provided', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'Ev', severity: 1 }]);
    assert.ok(!html.includes('opacity:0.6;margin-top:2px'), 'no detail block');
  });

  it('renders multiple events', () => {
    const html = createTimeline([
      { timestamp: 1_700_000_000_000, label: 'Alpha', severity: 1 },
      { timestamp: 1_700_001_000_000, label: 'Beta', severity: 2 },
    ]);
    assert.ok(html.includes('Alpha'), 'should include first event');
    assert.ok(html.includes('Beta'), 'should include second event');
  });

  it('renders timestamp text', () => {
    const html = createTimeline([{ timestamp: 1_700_000_000_000, label: 'Ev', severity: 1 }]);
    assert.ok(html.length > 50, 'should render some timestamp text');
  });
});

// ── createStatusIndicator ─────────────────────────────────────────────────────

describe('createStatusIndicator', () => {
  it('renders label', () => {
    const html = createStatusIndicator('nominal', 'All Systems');
    assert.ok(html.includes('All Systems'), 'should include label');
  });

  it('escapes label', () => {
    const html = createStatusIndicator('nominal', '<img>');
    assert.ok(!html.includes('<img>'), 'should escape label');
  });

  it('nominal → ok color', () => {
    const html = createStatusIndicator('nominal', 'OK');
    assert.ok(html.includes('severity-ok'), 'nominal → ok color');
  });

  it('elevated → medium color', () => {
    const html = createStatusIndicator('elevated', 'Elev');
    assert.ok(html.includes('severity-medium'), 'elevated → medium color');
  });

  it('stressed → high color', () => {
    const html = createStatusIndicator('stressed', 'Stress');
    assert.ok(html.includes('severity-high'), 'stressed → high color');
  });

  it('critical → critical color', () => {
    const html = createStatusIndicator('critical', 'Crit');
    assert.ok(html.includes('severity-critical'), 'critical → critical color');
  });

  it('critical includes animation', () => {
    const html = createStatusIndicator('critical', 'C');
    assert.ok(html.includes('animation'), 'critical should pulse');
  });

  it('nominal has no animation', () => {
    const html = createStatusIndicator('nominal', 'N');
    assert.ok(!html.includes('animation'), 'nominal should not pulse');
  });

  it('renders status text in output', () => {
    const html = createStatusIndicator('elevated', 'X');
    assert.ok(html.includes('elevated'), 'should show status word');
  });
});

// ── createStatRow ─────────────────────────────────────────────────────────────

describe('createStatRow', () => {
  it('renders stat label and value', () => {
    const html = createStatRow([{ label: 'Count', value: 42 }]);
    assert.ok(html.includes('Count'), 'should include label');
    assert.ok(html.includes('42'), 'should include value');
  });

  it('escapes label and value', () => {
    const html = createStatRow([{ label: '<b>', value: '<i>' }]);
    assert.ok(!html.includes('<b>'), 'should escape label');
    assert.ok(!html.includes('<i>'), 'should escape value');
  });

  it('renders up trend arrow', () => {
    const html = createStatRow([{ label: 'X', value: 1, trend: 'up' }]);
    assert.ok(html.includes('▲'), 'up trend → up arrow');
  });

  it('renders down trend arrow', () => {
    const html = createStatRow([{ label: 'X', value: 1, trend: 'down' }]);
    assert.ok(html.includes('▼'), 'down trend → down arrow');
  });

  it('renders stable indicator', () => {
    const html = createStatRow([{ label: 'X', value: 1, trend: 'stable' }]);
    assert.ok(html.includes('—'), 'stable → dash');
  });

  it('omits trend when not provided', () => {
    const html = createStatRow([{ label: 'X', value: 1 }]);
    assert.ok(!html.includes('▲') && !html.includes('▼') && !html.includes('—'), 'no trend element');
  });

  it('renders multiple stats', () => {
    const html = createStatRow([
      { label: 'Alpha', value: 1 },
      { label: 'Beta', value: 2 },
    ]);
    assert.ok(html.includes('Alpha'), 'first stat present');
    assert.ok(html.includes('Beta'), 'second stat present');
  });

  it('renders separator between multiple stats', () => {
    const html = createStatRow([
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
    ]);
    assert.ok(html.includes('rgba(255,255,255,0.08)'), 'should have separator');
  });
});

// ── createEmptyState ──────────────────────────────────────────────────────────

describe('createEmptyState', () => {
  it('renders message', () => {
    const html = createEmptyState('Nothing to show');
    assert.ok(html.includes('Nothing to show'), 'should include message');
  });

  it('escapes message', () => {
    const html = createEmptyState('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'), 'should escape message');
  });

  it('renders icon when provided', () => {
    const html = createEmptyState('Empty', '🛸');
    assert.ok(html.includes('🛸'), 'should include icon');
  });

  it('omits icon block when not provided', () => {
    const html = createEmptyState('Nothing');
    assert.ok(!html.includes('font-size:28px'), 'no icon block');
  });

  it('escapes icon', () => {
    const html = createEmptyState('X', '<img>');
    assert.ok(!html.includes('<img>'), 'should escape icon');
  });
});

// ── createErrorState ──────────────────────────────────────────────────────────

describe('createErrorState', () => {
  it('renders error message', () => {
    const html = createErrorState('Connection failed');
    assert.ok(html.includes('Connection failed'), 'should include message');
  });

  it('escapes message', () => {
    const html = createErrorState('<script>');
    assert.ok(!html.includes('<script>'), 'should escape message');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  });

  it('uses critical color', () => {
    const html = createErrorState('Err');
    assert.ok(html.includes('severity-critical'), 'should use critical color');
  });

  it('includes warning icon', () => {
    const html = createErrorState('Err');
    assert.ok(html.includes('⚠'), 'should include warning symbol');
  });
});
