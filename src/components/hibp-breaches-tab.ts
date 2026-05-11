/**
 * Pure render helpers for HibpBreachesPanel.
 *
 * Separated from the panel class so node:test can import them without
 * pulling in DOM/Vite-coupled Panel base. Matches the pattern used by
 * disease-outbreak-tabs.ts and wastewater-sites-tab.ts.
 */

import { escapeHtml } from '@/utils/sanitize';
import {
  BREACH_SEVERITY_COLOR,
  type BreachSeverity,
  type BreachStatistics,
  type HibpBreach,
} from '@/services/security/hibp-service';

const SEVERITY_LABEL: Record<BreachSeverity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
};

export function renderSeverityBadge(sev: BreachSeverity): string {
  const color = BREACH_SEVERITY_COLOR[sev];
  return `<span style="padding:1px 6px;border-radius:3px;background:${color}22;color:${color};border:1px solid ${color}66;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(SEVERITY_LABEL[sev])}</span>`;
}

export function formatPwnCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function shortDate(iso: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function renderDataClassChips(classes: readonly string[], maxShown = 4): string {
  if (classes.length === 0) return '<span style="color:#9ca3af;font-size:11px;">no data classes</span>';
  const head = classes.slice(0, maxShown);
  const rest = Math.max(0, classes.length - maxShown);
  const chips = head.map((c) => `<span style="display:inline-block;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,0.08);font-size:10px;margin-right:4px;">${escapeHtml(c)}</span>`).join('');
  const overflow = rest > 0 ? `<span style="font-size:10px;color:#9ca3af;">+${rest}</span>` : '';
  return `${chips}${overflow}`;
}

/** Render the row for a single breach. Used by both Latest and Search tabs. */
export function renderBreachRow(b: HibpBreach): string {
  const color = BREACH_SEVERITY_COLOR[b.severity];
  const domain = b.domain ? `<span style="color:var(--accent,#60a5fa);">${escapeHtml(b.domain)}</span>` : '';
  return `<div style="border:1px solid var(--border-subtle,#222);border-left:4px solid ${color};border-radius:3px;padding:10px;margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${renderSeverityBadge(b.severity)}
          <strong style="font-size:13px;">${escapeHtml(b.title || b.name)}</strong>
          ${domain}
        </div>
        <div style="font-size:11px;color:#9ca3af;">Breach ${escapeHtml(shortDate(b.breachDate))} · ${formatPwnCount(b.pwnCount)} accounts</div>
      </div>
    </div>
    <div style="margin-top:6px;">${renderDataClassChips(b.dataClasses)}</div>
  </div>`;
}

export function renderLatestTab(breaches: readonly HibpBreach[], loading: boolean): string {
  if (loading) return `<div class="panel-empty" style="padding:14px;">Loading recent breaches from HIBP…</div>`;
  if (breaches.length === 0) return `<div class="panel-empty" style="padding:14px;">No breaches added in the last 90 days.</div>`;
  const summary = `<div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;padding:0 2px;">${breaches.length} breach${breaches.length === 1 ? '' : 'es'} added in last 90 days</div>`;
  const rows = breaches.slice(0, 50).map((b) => renderBreachRow(b)).join('');
  return `<div>${summary}${rows}</div>`;
}

export function renderSearchTab(query: string, hits: readonly HibpBreach[], loading: boolean): string {
  const safeQuery = escapeHtml(query);
  const input = `<input type="text" class="hibp-search-input" value="${safeQuery}" placeholder="Search by company or domain — e.g. linkedin, adobe.com" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--border-subtle,#222);background:rgba(0,0,0,0.25);color:inherit;font-size:13px;margin-bottom:10px;">`;
  let body: string;
  if (loading) {
    body = `<div class="panel-empty" style="padding:14px;">Searching…</div>`;
  } else if (!query.trim()) {
    body = `<div class="panel-empty" style="padding:14px;text-align:center;opacity:0.7;">Enter a company name or domain to search 600+ known breaches.</div>`;
  } else if (hits.length === 0) {
    body = `<div class="panel-empty" style="padding:14px;">No breaches matched <strong>${safeQuery}</strong>.</div>`;
  } else {
    const summary = `<div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;padding:0 2px;">${hits.length} match${hits.length === 1 ? '' : 'es'} for "${safeQuery}"</div>`;
    body = `${summary}${hits.slice(0, 50).map((b) => renderBreachRow(b)).join('')}`;
  }
  return `<div>${input}${body}</div>`;
}

export function renderStatisticsTab(stats: BreachStatistics | null, loading: boolean): string {
  if (loading) return `<div class="panel-empty" style="padding:14px;">Loading breach statistics…</div>`;
  if (!stats || stats.totalBreaches === 0) return `<div class="panel-empty" style="padding:14px;">No HIBP data available.</div>`;

  const sevRows = (['critical', 'high', 'medium', 'low'] as const).map((sev) => {
    const count = stats.bySeverity[sev];
    const color = BREACH_SEVERITY_COLOR[sev];
    const pct = stats.totalBreaches > 0 ? (count / stats.totalBreaches) * 100 : 0;
    return `<div style="display:flex;align-items:center;gap:10px;font-size:12px;padding:4px 0;">
      <span style="min-width:50px;color:${color};font-weight:700;text-transform:uppercase;font-size:11px;">${escapeHtml(sev)}</span>
      <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};"></div>
      </div>
      <span style="font-variant-numeric:tabular-nums;color:#e5e7eb;min-width:48px;text-align:right;">${count.toLocaleString()}</span>
    </div>`;
  }).join('');

  const dataClassRows = stats.topDataClasses.slice(0, 10).map((row, i) => `
    <li style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span><span style="color:#9ca3af;display:inline-block;min-width:18px;">${i + 1}.</span>${escapeHtml(row.dataClass)}</span>
      <span style="font-variant-numeric:tabular-nums;color:#e5e7eb;">${row.count.toLocaleString()}</span>
    </li>`).join('');

  return `<div style="display:flex;flex-direction:column;gap:14px;padding:0 2px;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
      <div style="padding:8px 10px;border:1px solid var(--border-subtle,#222);border-radius:3px;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;">Total breaches</div>
        <div style="font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;">${stats.totalBreaches.toLocaleString()}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid var(--border-subtle,#222);border-radius:3px;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;">Accounts pwned</div>
        <div style="font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;">${formatPwnCount(stats.totalPwnedAccounts)}</div>
      </div>
      <div style="padding:8px 10px;border:1px solid var(--border-subtle,#222);border-radius:3px;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;">Added (90d)</div>
        <div style="font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;">${stats.recentBreaches.toLocaleString()}</div>
      </div>
    </div>
    <div>
      <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">By severity</div>
      ${sevRows}
    </div>
    <div>
      <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Top data classes</div>
      <ul style="margin:0;padding:0;list-style:none;">${dataClassRows}</ul>
    </div>
  </div>`;
}
