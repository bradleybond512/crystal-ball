import { Panel } from './Panel';
import type { LocalIDSAlert, LocalIDSSeverity, LocalIDSSource } from '@/types';
import { escapeHtml } from '@/utils/sanitize';

export class LocalIDSPanel extends Panel {
  private alerts: LocalIDSAlert[] = [];

  constructor() {
 super({
 id: 'local-ids',
 title: 'Local IDS',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Local network alerts from Suricata (signature IDS) and Zeek (network analysis). Desktop only — reads from /opt/homebrew/var/log/suricata/eve.json and Zeek spool.',
 });
 this.showLoading('Waiting for local IDS data…');
  }

  public update(alerts: LocalIDSAlert[]): void {
 this.alerts = alerts;
 this.setCount(alerts.length);
 this.render();
  }

  private render(): void {
 if (this.alerts.length === 0) {
 this.setContent(
 '<div class="panel-empty">No alerts — Suricata/Zeek may not be running, or no suspicious activity was found.</div>',
 );
 return;
 }

 const rows = this.alerts.map(a => {
 const rowClass = severityRowClass(a.severity);
 const sig = escapeHtml(a.signature.length > 50 ? `${a.signature.slice(0, 48)}…` : a.signature);
 const srcIp = escapeHtml(a.srcIp || '—');
 const destIp = escapeHtml(a.destIp || '—');
 const proto = escapeHtml(a.proto || '—');
 return `<tr class="${rowClass}">
 <td><span class="ids-src-badge ids-src-${safeSrcClass(a.source)}">${sourceLabel(a.source)}</span></td>
 <td class="ct-sev">${escapeHtml(a.severity)}</td>
 <td class="ids-sig" title="${escapeHtml(a.signature)}">${sig}</td>
 <td class="ids-ip">${srcIp}</td>
 <td class="ids-ip">${destIp}</td>
 <td class="ids-proto">${proto}</td>
 <td class="ids-time">${formatTs(a.ts)}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ids-panel-content">
 <table class="ct-table ids-table">
 <thead>
 <tr>
 <th>Source</th><th>Sev</th><th>Signature / Type</th>
 <th>Src IP</th><th>Dest IP</th><th>Proto</th><th>Time</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `);
  }
}

function severityRowClass(sev: LocalIDSSeverity): string {
  if (sev === 'critical') return 'ct-row-critical';
  if (sev === 'high') return 'ct-row-high';
  if (sev === 'medium') return 'ct-row-medium';
  return '';
}

const VALID_SOURCES: ReadonlySet<string> = new Set(['suricata', 'zeek_notice', 'zeek_conn']);

function safeSrcClass(source: string): string {
  return VALID_SOURCES.has(source) ? source : 'unknown';
}

function sourceLabel(source: LocalIDSSource): string {
  if (source === 'suricata') return 'Suricata';
  if (source === 'zeek_notice') return 'Zeek Notice';
  return 'Zeek Conn';
}

function formatTs(iso: string): string {
  try {
 return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
 return iso.slice(11, 19);
  }
}
