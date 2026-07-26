/**
 * Pure render helpers for IpInfoPanel.
 *
 * Same pattern as hibp-breaches-tab.ts: helpers live here so they can
 * be unit-tested with node:test; the panel class consumes them and
 * owns DOM wiring.
 */

import { escapeHtml } from '@/utils/sanitize';
import type {
  HistoryEntry,
  IpInfo,
  IpThreatContext,
} from '@/services/security/ipinfo-service';

export function countryFlagEmoji(code: string | undefined): string {
  if (code?.length !== 2 || !/^[A-Za-z]{2}$/.test(code)) return '';
  // Regional Indicator Symbol Letter A — base for ISO 3166-1 alpha-2 → flag.
  const A = 127_462;
  const base = 'A'.codePointAt(0)!;
  const upper = code.toUpperCase();
  const a = upper.codePointAt(0)! - base;
  const b = upper.codePointAt(1)! - base;
  return String.fromCodePoint(A + a, A + b);
}

export function renderSingleLookupForm(currentIp: string): string {
  const safe = escapeHtml(currentIp);
  return `<form class="ipinfo-form" style="display:flex;gap:8px;margin-bottom:12px;" autocomplete="off">
    <input type="text" class="ipinfo-input" value="${safe}" placeholder="8.8.8.8 or 2001:db8::1" style="flex:1;padding:8px 10px;border-radius:4px;border:1px solid var(--border-subtle,#222);background:rgba(0,0,0,0.25);color:inherit;font-size:13px;">
    <button type="submit" class="ipinfo-submit" style="padding:8px 14px;border-radius:4px;border:1px solid rgba(96,165,250,0.4);background:rgba(96,165,250,0.18);color:inherit;font-size:12px;cursor:pointer;">Lookup</button>
  </form>`;
}

export function renderResultCard(info: IpInfo | null, threat: IpThreatContext | null): string {
  if (!info) return '';
  const flag = countryFlagEmoji(info.countryCode);
  const country = info.country ? `${flag} ${info.country}` : flag;
  const cityRegion = [info.city, info.region].filter(Boolean).join(', ') || '—';
  const coord = info.lat !== undefined && info.lon !== undefined
    ? `${info.lat.toFixed(4)}, ${info.lon.toFixed(4)}`
    : '—';
  const hostname = info.hostname ? escapeHtml(info.hostname) : '—';
  const org = info.orgName ? escapeHtml(info.orgName) : '—';
  const asn = info.asn ? `<span style="color:var(--accent,#60a5fa);">${escapeHtml(info.asn)}</span>` : '—';
  const tz = info.timezone ? escapeHtml(info.timezone) : '—';
  const anycast = info.anycast === true;

  const rows: [string, string][] = [
    ['IP', `<strong>${escapeHtml(info.ip)}</strong>`],
    ['Hostname', hostname],
    ['Country', escapeHtml(country) || '—'],
    ['City / Region', escapeHtml(cityRegion)],
    ['Coordinates', escapeHtml(coord)],
    ['ASN', asn],
    ['Org', org],
    ['Timezone', tz],
  ];
  if (anycast) rows.push(['Anycast', '<span style="color:#fbbf24;">yes</span>']);
  if (info.bogon) rows.push(['Bogon', '<span style="color:#fb923c;">private/reserved</span>']);

  const body = rows.map(([k, v]) => `<div style="display:flex;gap:12px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="min-width:110px;color:#9ca3af;">${escapeHtml(k)}</span><span style="flex:1;word-break:break-all;">${v}</span></div>`).join('');

  return `<div style="border:1px solid var(--border-subtle,#222);border-radius:4px;padding:12px;margin-bottom:12px;">
    ${body}
    ${renderThreatContext(threat)}
  </div>`;
}

export function renderThreatContext(threat: IpThreatContext | null): string {
  if (!threat || (threat.notes.length === 0 && !threat.knownBadActor)) return '';
  const color = threat.knownBadActor ? '#dc2626' : '#fbbf24';
  const label = threat.knownBadActor ? 'KNOWN BAD ACTOR' : 'CONTEXT';
  const items = threat.notes.map((n) => `<li style="margin:2px 0;">${escapeHtml(n)}</li>`).join('');
  return `<div style="margin-top:10px;padding:8px 10px;border:1px solid ${color}66;background:${color}22;border-radius:3px;">
    <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">⚠ ${label}</div>
    <ul style="margin:0;padding-left:18px;font-size:11px;color:#e5e7eb;">${items}</ul>
  </div>`;
}

export function renderHistory(history: readonly HistoryEntry[]): string {
  if (history.length === 0) {
    return `<div style="font-size:11px;color:#9ca3af;padding:8px 2px;">No recent lookups yet.</div>`;
  }
  const items = history.map((h) => {
    const flag = countryFlagEmoji(h.countryCode);
    const where = [flag, h.city].filter(Boolean).join(' ') || '—';
    const asn = h.asn ? `<span style="color:#9ca3af;">${escapeHtml(h.asn)}</span>` : '';
    return `<li class="ipinfo-history-item" data-ip="${escapeHtml(h.ip)}" style="display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:3px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span><strong>${escapeHtml(h.ip)}</strong> · ${escapeHtml(where)}</span>${asn}
    </li>`;
  }).join('');
  return `<div style="margin-top:14px;">
    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Recent lookups</div>
    <ul class="ipinfo-history" style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}

export function renderBatchForm(currentValue: string): string {
  const safe = escapeHtml(currentValue);
  return `<form class="ipinfo-batch-form" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
    <textarea class="ipinfo-batch-input" rows="5" placeholder="One IP per line (max 50)" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--border-subtle,#222);background:rgba(0,0,0,0.25);color:inherit;font-size:12px;font-family:monospace;resize:vertical;">${safe}</textarea>
    <button type="submit" class="ipinfo-batch-submit" style="align-self:flex-start;padding:6px 12px;border-radius:4px;border:1px solid rgba(96,165,250,0.4);background:rgba(96,165,250,0.18);color:inherit;font-size:12px;cursor:pointer;">Look up batch</button>
  </form>`;
}

export function renderLookupNotice(
  message: string,
  tone: 'loading' | 'error' = 'loading',
): string {
  const color = tone === 'error' ? 'color:var(--color-warning,#fb923c);' : '';
  return `<div class="panel-empty" style="padding:14px;${color}">${escapeHtml(message)}</div>`;
}

export function renderBatchResults(rows: readonly (IpInfo | null)[], originalInputs: readonly string[]): string {
  if (rows.length === 0) return '';
  const lines = rows.map((info, i) => {
    if (!info) {
      const raw = escapeHtml(originalInputs[i] ?? '');
      return `<tr><td style="padding:4px 8px;font-family:monospace;color:#fb923c;">${raw}</td><td style="padding:4px 8px;color:#9ca3af;font-style:italic;">lookup failed</td><td></td><td></td></tr>`;
    }
    const flag = countryFlagEmoji(info.countryCode);
    const country = info.country ? `${flag} ${info.country}` : flag;
    const where = [info.city, info.region].filter(Boolean).join(', ');
    return `<tr>
      <td style="padding:4px 8px;font-family:monospace;font-weight:600;">${escapeHtml(info.ip)}</td>
      <td style="padding:4px 8px;">${escapeHtml(country) || '—'}</td>
      <td style="padding:4px 8px;color:#9ca3af;">${escapeHtml(where) || '—'}</td>
      <td style="padding:4px 8px;color:var(--accent,#60a5fa);">${escapeHtml(info.asn ?? '—')}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead><tr style="border-bottom:1px solid var(--border-subtle,#222);color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;font-size:10px;">
      <th style="padding:6px 8px;text-align:left;">IP</th>
      <th style="padding:6px 8px;text-align:left;">Country</th>
      <th style="padding:6px 8px;text-align:left;">City / Region</th>
      <th style="padding:6px 8px;text-align:left;">ASN</th>
    </tr></thead>
    <tbody>${lines}</tbody>
  </table>`;
}

/** Split a textarea blob into one IP per line, drop blanks and
 *  trim. Exported so the panel handler + tests agree. */
export function parseBatchInput(blob: string, maxIps = 50): string[] {
  const lines = blob
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return lines.slice(0, maxIps);
}
