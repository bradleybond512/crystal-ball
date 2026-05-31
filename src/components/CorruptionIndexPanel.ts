/**
 * CorruptionIndexPanel (panel id: `corruption-index`).
 *
 * Tracks corruption as a geopolitical risk indicator using
 * Transparency International CPI-inspired data. High corruption
 * correlates with state fragility, authoritarian consolidation,
 * sanctions evasion, and conflict financing.
 *
 * Pure logic lives in `corruption-index-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  categoryClass,
  trendClass,
  getCategory,
  type CountryRecord,
  type KeyEvent,
} from './corruption-index-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

/** Map CPI score to a CSS colour (mirrors category thresholds). */
function scoreColor(score: number): string {
  if (score >= 75) return 'var(--severity-low,      #4caf50)';
  if (score >= 50) return 'var(--severity-medium,   #ff9800)';
  if (score >= 25) return 'var(--severity-high,     #ef4444)';
  return               'var(--severity-critical, #b71c1c)';
}

/** Arrow glyph + colour for trend. */
function trendGlyph(trend: CountryRecord['trend']): [string, string] {
  switch (trend) {
    case 'improving': return ['↑', '#4caf50'];
    case 'stable':    return ['→', '#9e9e9e'];
    case 'declining': return ['↓', '#ef4444'];
  }
}

export class CorruptionIndexPanel extends Panel {
  static readonly panelId = 'corruption-index';
  static readonly title   = 'Corruption Index';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id:           CorruptionIndexPanel.panelId,
      title:        CorruptionIndexPanel.title,
      showCount:    true,
      trackActivity: false,
      infoTooltip:
        'Tracks corruption as a geopolitical risk indicator using Transparency International ' +
        'CPI-inspired data (0–100, higher = cleaner). High corruption correlates with state ' +
        'fragility, authoritarian consolidation, sanctions evasion, and conflict financing. ' +
        'Covers 20 countries across four categories. Refreshes every 24 hours.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(
        this.getContentElement(),
        h('div', { className: 'panel-empty' }, 'Data unavailable'),
      );
      return;
    }

    const {
      countries,
      globalAvgWeighted,
      globalAvgUnweighted,
      cleanCount,
      satisfactoryCount,
      problematicCount,
      veryCorruptCount,
      decliningCount,
      improvingCount,
      topEvents,
    } = data;

    // Count badge shows countries at "high-risk" corruption levels
    this.setCount(problematicCount + veryCorruptCount);

    replaceChildren(
      this.getContentElement(),
      this.buildOverviewSection(
        globalAvgWeighted,
        globalAvgUnweighted,
        cleanCount,
        satisfactoryCount,
        problematicCount,
        veryCorruptCount,
        decliningCount,
        improvingCount,
      ),
      this.buildCountryTable(countries),
      this.buildEventsSection(topEvents),
    );
  }

  // ── Section 1: Global Overview ────────────────────────────────────────

  private buildOverviewSection(
    weightedAvg:    number,
    unweightedAvg:  number,
    clean:          number,
    satisfactory:   number,
    problematic:    number,
    veryCorrupt:    number,
    declining:      number,
    improving:      number,
  ): HTMLElement {
    const avgColor = scoreColor(weightedAvg);

    const cats = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;font-size:11px;margin-top:6px' },
      h('span', { style: 'background:#1b5e20;color:#a5d6a7;padding:2px 8px;border-radius:10px' },
        `Clean (≥75): ${clean}`),
      h('span', { style: 'background:#1a237e;color:#9fa8da;padding:2px 8px;border-radius:10px' },
        `Satisfactory (50–74): ${satisfactory}`),
      h('span', { style: 'background:#e65100;color:#ffccbc;padding:2px 8px;border-radius:10px' },
        `Problematic (25–49): ${problematic}`),
      h('span', { style: 'background:#b71c1c;color:#ffcdd2;padding:2px 8px;border-radius:10px' },
        `Very Corrupt (<25): ${veryCorrupt}`),
    );

    return h('div', { className: 'app-section' },
      sectionHeader('Global Corruption Overview'),
      h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:4px' },
        h('div',
          h('div', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase;letter-spacing:.5px' },
            'Pop.-Weighted Avg CPI'),
          h('div', { style: `font-size:26px;font-weight:700;color:${avgColor};line-height:1.1` },
            String(weightedAvg)),
          h('div', { style: 'font-size:10px;color:#9e9e9e;margin-top:1px' }, '0 = most corrupt · 100 = cleanest'),
        ),
        h('div',
          h('div', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase;letter-spacing:.5px' },
            'Unweighted Avg'),
          h('div', { style: 'font-size:26px;font-weight:700;color:#ccc;line-height:1.1' },
            String(unweightedAvg)),
        ),
        h('div', { style: 'font-size:12px;margin-top:4px' },
          h('div', { style: 'color:#ef4444;margin-bottom:2px' }, `↓ ${declining} declining`),
          h('div', { style: 'color:#4caf50' }, `↑ ${improving} improving`),
        ),
      ),
      cats,
    );
  }

  // ── Section 2: Country Table ───────────────────────────────────────────

  private buildCountryTable(countries: CountryRecord[]): HTMLElement {
    const highRisk = countries.filter(c => {
      const cat = getCategory(c.score);
      return cat === 'Problematic' || cat === 'Very Corrupt';
    }).length;
    const badge = highRisk > 0 ? countBadge(highRisk, 'high-risk') : undefined;

    const tbody = h('tbody');
    for (const c of countries) {
      const [glyph, glyphColor] = trendGlyph(c.trend);
      const cat   = getCategory(c.score);
      const clsC  = categoryClass(cat);
      const clsT  = trendClass(c.trend);

      void clsC; // CSS classes available for styling hooks
      void clsT;

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${scoreColor(c.score)}` },
            c.country),
          cell(String(c.score), `font-weight:700;color:${scoreColor(c.score)};text-align:right`),
          h('td', { style: `padding:3px 6px;font-size:13px;color:${glyphColor};text-align:center` }, glyph),
          h('td', { style: 'padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right' },
            h('span', { style: `color:${scoreColor(c.score)}` }, cat)),
          cell(c.keyRisk, 'color:#9e9e9e;font-size:11px'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('CPI Rankings (20 Countries)', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · CPI score · trend · category · key risk indicator'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Key Events ─────────────────────────────────────────────

  private buildEventsSection(events: KeyEvent[]): HTMLElement {
    const rows = events.map(ev =>
      h('div', { style: 'margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #333' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
          h('span', { style: 'font-size:12px;font-weight:600;color:#e0e0e0' }, ev.title),
          h('span', { style: 'font-size:10px;color:#facc15;margin-left:8px;flex-shrink:0' }, String(ev.year)),
        ),
        h('div', { style: 'font-size:10px;color:#9e9e9e;margin-top:1px;margin-bottom:2px' },
          ev.category),
        h('div', { style: 'font-size:11px;color:#ccc;line-height:1.4' }, ev.description),
      ),
    );

    return h('div', { className: 'app-section' },
      sectionHeader('Key Corruption Events (2022–2024)'),
      ...rows,
    );
  }
}
