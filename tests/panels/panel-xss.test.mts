/**
 * Panel HTML/XSS fixture coverage — per
 * docs/CLAUDE_EXTRA_BUG_SECURITY_CHECKS_2026-04-29.md Priority 1.
 *
 * Many panels render remote-sourced strings (news titles, alert
 * headlines, country names, error messages, feed names) and write
 * them into the DOM via `setContent(html)` → `innerHTML`. The path
 * is safe ONLY when each string passes through `escapeHtml()` /
 * `sanitizeUrl()` first. Manual code review can miss a single
 * unescaped interpolation.
 *
 * This test injects classic XSS payloads into fixture data, mounts
 * each target panel, and asserts the rendered HTML contains no
 * executable markup. If a panel renders a remote string without
 * escaping, this test fails with a clear panel-level pointer.
 */

import './setup-dom.mts';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_SMOKE_REGISTRY } from './panel-smoke-registry.mts';
import { installFixture, clearFixtures } from './fixture-store.mts';

const XSS_PAYLOADS = {
  scriptTag: '<script>window.__xss_canary=1;</script>',
  imgOnError: '<img src=x onerror="window.__xss_canary=1">',
  svgOnLoad: '<svg onload=window.__xss_canary=1>',
  jsScheme: 'javascript:window.__xss_canary=1',
  attrBreak: '" onmouseover="window.__xss_canary=1',
  textCanary: 'CANARY-PAYLOAD-DO-NOT-EXECUTE',
};

function assertSafeHtml(html: string, panelId: string): void {
  // The escaped form (`&lt;script&gt;`) is fine; the raw form is not.
  assert.doesNotMatch(
    html,
    /<script\b/i,
    `Panel ${panelId} rendered raw <script> tag — escapeHtml() missing somewhere in render path.`,
  );
  // <img src=x onerror=...> is a separate vector
  assert.doesNotMatch(
    html,
    /<img[^>]*\bonerror\s*=/i,
    `Panel ${panelId} rendered raw <img onerror=...> — escapeHtml() missing.`,
  );
  // <svg onload=...>
  assert.doesNotMatch(
    html,
    /<svg[^>]*\bonload\s*=/i,
    `Panel ${panelId} rendered raw <svg onload=...>.`,
  );
  // javascript: scheme inside an href / src must not appear unescaped
  assert.doesNotMatch(
    html,
    /(?:href|src)\s*=\s*["']?javascript:/i,
    `Panel ${panelId} rendered an href/src with javascript: scheme — sanitizeUrl() missing.`,
  );
  // Attribute-break injection: " onmouseover= leaks attributes
  assert.doesNotMatch(
    html,
    /\bonmouseover\s*=\s*["'][^"']*window\.__xss_canary/i,
    `Panel ${panelId} let an attribute-break payload through.`,
  );
}

async function mountAndCapture(panelId: string, install: () => void): Promise<{ html: string; cleanup: () => void }> {
  const factory = PANEL_SMOKE_REGISTRY[panelId];
  if (!factory) throw new Error(`No factory for panel ${panelId}`);
  clearFixtures();
  install();
  const panel = await factory.create();
  const el = panel.getElement();
  const container = document.createElement('div');
  container.id = `mount-xss-${panelId}`;
  document.body.append(container);
  container.append(el);
  // Allow fetch + render + setContent debounce
  await new Promise<void>((r) => setTimeout(r, factory.waitMs ?? 100));
  await new Promise<void>((r) => setTimeout(r, 250));
  const html = el.innerHTML;
  return {
    html,
    cleanup: () => {
      try {
        const d = panel as unknown as { dispose?: () => void; destroy?: () => void };
        d.dispose?.();
        d.destroy?.();
      } catch { /* ignore */ }
      el.remove();
      container.remove();
    },
  };
}

test('XSS: GDELT Intel panel escapes title + source from feed', async () => {
  const { html, cleanup } = await mountAndCapture('gdelt-intel', () => {
    installFixture('/api/gdelt-intel', {
      events: [
        {
          title: `${XSS_PAYLOADS.scriptTag} ${XSS_PAYLOADS.textCanary}`,
          url: XSS_PAYLOADS.jsScheme, // sanitizeUrl should reject
          source: XSS_PAYLOADS.imgOnError,
          tone: -2.0,
          country: XSS_PAYLOADS.attrBreak,
          timestamp: Date.now(),
        },
      ],
      updatedAt: Math.floor(Date.now() / 1000),
    });
  });
  try {
    assertSafeHtml(html, 'gdelt-intel');
  } finally {
    cleanup();
  }
});

test('XSS: live-news panel escapes title + source from feed', async () => {
  const { html, cleanup } = await mountAndCapture('live-news', () => {
    installFixture('/api/news', {
      items: [
        {
          id: 'n1',
          title: XSS_PAYLOADS.scriptTag,
          url: XSS_PAYLOADS.jsScheme,
          source: XSS_PAYLOADS.imgOnError,
          publishedAt: Date.now(),
          summary: XSS_PAYLOADS.svgOnLoad,
        },
      ],
      updatedAt: Date.now(),
    });
  });
  try {
    assertSafeHtml(html, 'live-news');
  } finally {
    cleanup();
  }
});

test('XSS: service-status panel escapes service names', async () => {
  const { html, cleanup } = await mountAndCapture('service-status', () => {
    installFixture('/api/service-status', {
      success: true,
      timestamp: new Date().toISOString(),
      services: [
        { name: XSS_PAYLOADS.scriptTag, status: 'operational', category: XSS_PAYLOADS.imgOnError },
        { name: 'Cloudflare', status: 'operational', category: 'infrastructure' },
      ],
      summary: { operational: 2, degraded: 0, outage: 0, unknown: 0 },
    });
  });
  try {
    assertSafeHtml(html, 'service-status');
  } finally {
    cleanup();
  }
});

test('XSS: national-debt panel escapes country names', async () => {
  const { html, cleanup } = await mountAndCapture('national-debt', () => {
    installFixture('/api/national-debt', {
      countries: [
        {
          code: 'XX',
          name: XSS_PAYLOADS.scriptTag,
          debtPctGdp: 999,
          year: XSS_PAYLOADS.imgOnError,
        },
      ],
      updatedAt: Date.now(),
    });
  });
  try {
    assertSafeHtml(html, 'national-debt');
  } finally {
    cleanup();
  }
});

test('XSS: fuel-prices panel escapes region names', async () => {
  const { html, cleanup } = await mountAndCapture('fuel-prices', () => {
    installFixture('/api/fuel-prices', {
      regions: [
        {
          name: XSS_PAYLOADS.scriptTag,
          gasolineUsd: 1,
          dieselUsd: 1,
          period: XSS_PAYLOADS.imgOnError,
        },
      ],
      keyMissing: false,
      updatedAt: Date.now(),
    });
  });
  try {
    assertSafeHtml(html, 'fuel-prices');
  } finally {
    cleanup();
  }
});

test('XSS: faa-weather-cams panel escapes camera names + states', async () => {
  const { html, cleanup } = await mountAndCapture('faa-weather-cams', () => {
    installFixture('/api/faa-cameras', {
      cameras: [
        {
          id: 'BAD',
          name: XSS_PAYLOADS.scriptTag,
          lat: 47,
          lon: -122,
          state: XSS_PAYLOADS.imgOnError,
          category: 'urban',
          imageUrl: XSS_PAYLOADS.jsScheme,
          isOnline: true,
          lastUpdated: new Date().toISOString(),
        },
      ],
    });
  });
  try {
    assertSafeHtml(html, 'faa-weather-cams');
  } finally {
    cleanup();
  }
});

test('XSS: internet-disruptions panel escapes degraded source names', async () => {
  const { html, cleanup } = await mountAndCapture('internet-disruptions', () => {
    installFixture('/api/comms-health', {
      overall: 'normal',
      bgp: { hijacks: 0, leaks: 0, severity: 'normal' },
      ixp: { status: 'operational', degraded: [XSS_PAYLOADS.scriptTag] },
      ddos: { l7: 'normal', l3: 'normal', cloudflareKeyMissing: false },
      cables: { degraded: [XSS_PAYLOADS.imgOnError], normal: ['Atlantic-1'] },
      updatedAt: new Date().toISOString(),
    });
  });
  try {
    assertSafeHtml(html, 'internet-disruptions');
  } finally {
    cleanup();
  }
});

test('XSS: window.__xss_canary is never set after mounting any panel', () => {
  // Catch-all: if any of the previous tests' payloads actually
  // executed, the global canary would be set on the happy-dom window.
  const w = globalThis as unknown as { __xss_canary?: number };
  assert.equal(w.__xss_canary, undefined, 'XSS canary fired — a payload above bypassed escaping');
});
