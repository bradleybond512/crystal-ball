import { Panel } from './Panel';
import { alertDB } from '@/services/alert-store';
import type { UnifiedAlert, AlertSeverity } from '@/services/unified-alerts';
import { escapeHtml } from '@/utils/sanitize';

type ReasonFilter = 'all' | 'asn_match' | 'platform_targeted' | 'country_critical' | 'high_severity';

interface ReactorMeta {
  reason?: string;
  reasonExplanation?: string;
  indicator?: string;
  sourceFeed?: string;
}

const REFRESH_MS = 30_000;
const REACTOR_SOURCE = 'threat-reactor';
const ALL_SEVERITIES: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export class ThreatInboxPanel extends Panel {
  private alerts: UnifiedAlert[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private severityFilter = new Set<AlertSeverity>(ALL_SEVERITIES);
  private showAcknowledged = false;
  private reasonFilter: ReasonFilter = 'all';

  constructor() {
 super({
 id: 'threat-inbox',
 title: 'Threat Inbox',
 showCount: true,
 trackActivity: true,
 });
 queueMicrotask(() => { void this.refresh(); });
 this.refreshTimer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }

  private async refresh(): Promise<void> {
 try {
 const rows = await alertDB.getAll({ source: REACTOR_SOURCE });
 this.alerts = rows;
 this.render();
 } catch {
 this.showError('Failed to load threat inbox');
 }
  }

  private filtered(): UnifiedAlert[] {
 return this.alerts.filter((a) => {
 if (!this.severityFilter.has(a.severity)) return false;
 if (!this.showAcknowledged && a.acknowledged) return false;
 if (this.reasonFilter !== 'all') {
 const meta = (a.raw ?? {}) as ReactorMeta;
 if (meta.reason !== this.reasonFilter) return false;
 }
 return true;
 });
  }

  private render(): void {
 const filtered = this.filtered();
 this.setCount(filtered.length);

 const sevOptions = ALL_SEVERITIES.map((s) =>
 `<label class="ti-sev-opt"><input type="checkbox" data-sev="${s}" ${this.severityFilter.has(s) ? 'checked' : ''}/> ${s}</label>`,
 ).join('');

 const reasonOptions = (['all', 'asn_match', 'platform_targeted', 'country_critical', 'high_severity'] as ReasonFilter[])
 .map((r) => `<option value="${r}" ${this.reasonFilter === r ? 'selected' : ''}>${r.replace(/_/g, ' ')}</option>`)
 .join('');

 const filtersHtml = `
 <div class="ti-filters">
 <div class="ti-sev-group">${sevOptions}</div>
 <label class="ti-ack-opt"><input type="checkbox" data-show-ack ${this.showAcknowledged ? 'checked' : ''}/> show acknowledged</label>
 <select class="ti-reason-select">${reasonOptions}</select>
 </div>
 `;

 if (filtered.length === 0) {
 this.setContent(`${filtersHtml}<div class="panel-empty">No relevant cyber threats detected.</div>`);
 this.bindFilterEvents();
 return;
 }

 const rows = filtered.map((a) => {
 const meta = (a.raw ?? {}) as ReactorMeta;
 const rowClass = severityRowClass(a.severity);
 const time = timeAgo(a.timestamp);
 const reason = meta.reason ?? '—';
 const sourceFeed = meta.sourceFeed ?? '—';
 const pinned = a.pinned ? ' ti-pinned' : '';
 const acked = a.acknowledged ? ' ti-acked' : '';
 return `<tr class="${rowClass} ti-row${pinned}${acked}" data-id="${escapeHtml(a.id)}">
 <td class="ti-time">${time}</td>
 <td class="ti-sev">${escapeHtml(a.severity)}</td>
 <td class="ti-title">${escapeHtml(a.title)}</td>
 <td class="ti-reason"><span class="ti-reason-chip">${escapeHtml(reason)}</span></td>
 <td class="ti-source">${escapeHtml(sourceFeed)}</td>
 <td class="ti-actions">
 <button class="ti-btn" data-act="ack" title="Acknowledge">${a.acknowledged ? 'Acked' : 'Ack'}</button>
 <button class="ti-btn" data-act="pin" title="Pin">${a.pinned ? 'Unpin' : 'Pin'}</button>
 <button class="ti-btn" data-act="copy" title="Copy IOC">Copy</button>
 <button class="ti-btn" data-act="map" title="Show on map">Map</button>
 </td>
 </tr>`;
 }).join('');

 this.setContent(`
 ${filtersHtml}
 <div class="ct-panel-content">
 <table class="eq-table ct-table ti-table">
 <thead>
 <tr>
 <th>Time</th>
 <th>Sev</th>
 <th>Title</th>
 <th>Reason</th>
 <th>Source</th>
 <th>Actions</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `);

 this.bindFilterEvents();
 this.bindRowEvents();
  }

  private bindFilterEvents(): void {
 const root = this.getContentElement();
 root.querySelectorAll<HTMLInputElement>('input[data-sev]').forEach((el) => {
 el.addEventListener('change', () => {
 const sev = el.dataset.sev as AlertSeverity;
 if (el.checked) this.severityFilter.add(sev);
 else this.severityFilter.delete(sev);
 this.render();
 });
 });
 const ack = root.querySelector<HTMLInputElement>('input[data-show-ack]');
 ack?.addEventListener('change', () => {
 this.showAcknowledged = ack.checked;
 this.render();
 });
 const reason = root.querySelector<HTMLSelectElement>('.ti-reason-select');
 reason?.addEventListener('change', () => {
 this.reasonFilter = reason.value as ReasonFilter;
 this.render();
 });
  }

  private bindRowEvents(): void {
 const tbody = this.getContentElement().querySelector('tbody');
 tbody?.addEventListener('click', (e) => {
 const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
 if (!btn) return;
 const row = btn.closest('tr[data-id]') as HTMLElement | null;
 const id = row?.dataset.id;
 if (!id) return;
 const alert = this.alerts.find((a) => a.id === id);
 if (!alert) return;
 const act = btn.dataset.act;
 if (act === 'ack') void this.actAck(alert);
 else if (act === 'pin') void this.actPin(alert);
 else if (act === 'copy') void this.actCopy(alert);
 else if (act === 'map') this.actMap(alert);
 });
  }

  private async actAck(alert: UnifiedAlert): Promise<void> {
 alert.acknowledged = true;
 try { await alertDB.put(alert); } catch { /* noop */ }
 this.render();
  }

  private async actPin(alert: UnifiedAlert): Promise<void> {
 alert.pinned = !alert.pinned;
 try { await alertDB.put(alert); } catch { /* noop */ }
 this.render();
  }

  private async actCopy(alert: UnifiedAlert): Promise<void> {
 const meta = (alert.raw ?? {}) as ReactorMeta;
 const ioc = meta.indicator ?? alert.title;
 try { await navigator.clipboard.writeText(ioc); } catch { /* noop */ }
  }

  private actMap(alert: UnifiedAlert): void {
 if (!alert.location) return;
 window.dispatchEvent(new CustomEvent('wm:focus-map', {
 detail: { lat: alert.location.lat, lon: alert.location.lon },
 }));
  }
}

function severityRowClass(s: AlertSeverity): string {
  return { critical: 'eq-row eq-major', high: 'eq-row eq-strong', medium: 'eq-row eq-moderate', low: 'eq-row', info: 'eq-row' }[s] ?? 'eq-row';
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 0) return 'now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
