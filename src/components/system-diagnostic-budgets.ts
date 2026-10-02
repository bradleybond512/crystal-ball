/**
 * "API Budgets" tab of System Diagnostic (R4-BUG-005 step 2). Pure HTML
 * rendering of the Quota Governor report; every string from the sidecar is
 * escaped, and numbers come from the validated report only.
 */
import { escapeHtml } from '@/utils/sanitize';
import {
  formatUntil,
  formatWindow,
  type QuotaProviderStatus,
  type QuotaState,
  type QuotaStatusResult,
  type QuotaWindowStatus,
} from '@/services/diagnostics/quota-budgets';

const STATE_LABEL: Record<QuotaState, string> = {
  ok: 'OK',
  paced: 'Paced',
  background_paused: 'Background paused',
  cooldown: 'Provider cooldown',
};

const STATE_COLOR: Record<QuotaState, string> = {
  ok: 'var(--severity-ok)',
  paced: 'var(--severity-medium)',
  background_paused: 'var(--severity-high)',
  cooldown: 'var(--severity-high)',
};

const MUTED = 'color:var(--text-secondary);font-size:11px;';

function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function windowMeter(w: QuotaWindowStatus, unit: string, label: string): string {
  const span = `${formatWindow(w.windowMs)} window`;
  if (w.limit === null || w.limit <= 0) {
    return `<div style="${MUTED}">${count(w.used)} ${escapeHtml(unit)} in the last ${escapeHtml(span)} · no app limit</div>`;
  }
  const pct = Math.min(100, (w.used / w.limit) * 100);
  const ceiling = w.backgroundCeiling === null ? '' : `<span aria-hidden="true" style="position:absolute;top:-2px;bottom:-2px;left:${((w.backgroundCeiling / w.limit) * 100).toFixed(1)}%;width:2px;background:var(--text-secondary);"></span>`;
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div role="meter" aria-label="${escapeHtml(`${label}: ${count(w.used)} of ${count(w.limit)} ${unit} per ${span}`)}" aria-valuemin="0" aria-valuemax="${w.limit}" aria-valuenow="${Math.min(w.used, w.limit)}"
      style="position:relative;flex:1;height:6px;border-radius:3px;background:var(--border-subtle);">
      <span style="position:absolute;left:0;top:0;bottom:0;width:${pct.toFixed(1)}%;border-radius:3px;background:var(--accent);"></span>${ceiling}
    </div>
    <span style="${MUTED}white-space:nowrap;font-variant-numeric:tabular-nums;">${count(w.used)} / ${count(w.limit)} ${escapeHtml(unit)} · ${escapeHtml(span)}</span>
  </div>`;
}

function details(p: QuotaProviderStatus, now: number): string[] {
  const out: string[] = [];
  if (p.cooldownUntil !== null) {
    out.push(`The provider asked us to wait: background calls resume ${escapeHtml(formatUntil(p.cooldownUntil, now))}.`);
  } else if (p.budgetFreesAt !== null) {
    out.push(`Background refreshes resume ${escapeHtml(formatUntil(p.budgetFreesAt, now))}; you can still trigger lookups.`);
  } else if (p.state === 'paced') {
    out.push('Refreshing half as often to stay within budget.');
  }
  if (p.providerRemaining) out.push(`Provider reports ${count(p.providerRemaining.value)} ${escapeHtml(p.unit)} left.`);
  if (p.last429At !== null) out.push(`Last "too many requests": ${escapeHtml(new Date(p.last429At).toLocaleString())}.`);
  if (p.tokens !== undefined) out.push(`${count(p.tokens)} tokens in the last ${escapeHtml(formatWindow(p.windows[0]?.windowMs ?? 0))}.`);
  if (p.estimate) out.push('Points are an estimate; PurpleAir’s developer portal has the exact balance.');
  if (p.unverified) out.push('Limit not verified against the provider’s docs.');
  return out;
}

function providerRow(p: QuotaProviderStatus, now: number): string {
  const lines = details(p, now);
  return `<div class="syd-quota-row" data-provider="${escapeHtml(p.id)}" style="padding:8px 12px;border-bottom:1px dotted var(--border-subtle);display:flex;flex-direction:column;gap:4px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-size:12px;font-weight:600;">${escapeHtml(p.label)}${p.observeOnly ? ` <span style="${MUTED}font-weight:400;">tracked only</span>` : ''}</span>
      <span class="syd-quota-state" style="font-size:10px;font-weight:700;text-transform:uppercase;color:${STATE_COLOR[p.state]};">${escapeHtml(STATE_LABEL[p.state])}</span>
    </div>
    ${p.windows.map((w) => windowMeter(w, p.unit, p.label)).join('')}
    ${lines.length > 0 ? `<div style="${MUTED}">${lines.join(' ')}</div>` : ''}
  </div>`;
}

export function renderQuotaBudgetsHtml(view: { loading: boolean; result: QuotaStatusResult | null }, now = Date.now()): string {
  if (!view.result) {
    return `<div style="padding:12px;${MUTED}">${view.loading ? 'Loading API budgets…' : 'API budgets have not loaded yet.'}</div>`;
  }
  if (!view.result.ok) {
    return `<div style="padding:12px;${MUTED}">API budgets come from the desktop sidecar, which did not answer (${escapeHtml(view.result.error)}).</div>`;
  }
  const { report } = view.result;
  const share = Math.round(report.targetShare * 100);
  const waiting = report.throttledHosts.map((h) => escapeHtml(h.host) + ' (' + escapeHtml(formatUntil(h.until, now)) + ')');
  const hosts = waiting.length === 0
    ? ''
    : `<div style="padding:8px 12px;${MUTED}">Also waiting on: ${waiting.join(', ')}.</div>`;
  return `<div class="syd-quota">
    <div style="padding:8px 12px;${MUTED}">Background refreshes stop at ${share}% of each limit (the marker); the rest is kept for things you trigger, like key tests and lookups. Counts survive restarts. Map tiles and the 3D globe load in the app window and are not counted here.</div>
    ${report.providers.map((p) => providerRow(p, now)).join('')}
    ${hosts}
  </div>`;
}
