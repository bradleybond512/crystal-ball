import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

interface NetworkRule {
  id: string;
  action: string;
  process: string;
  host: string;
  ports: string;
  protocol: string;
  notes: string;
}

interface NetworkRulesetResponse {
  name?: string;
  description?: string;
  ruleCount?: number;
  rules?: NetworkRule[];
  sourcePath?: string;
  error?: string;
}

// Surfaces the bundled Little Snitch ruleset (tools/littlesnitch/crystal-ball.lsrules)
// inside the app so the user can see exactly what outbound traffic Crystal Ball
// needs without leaving for Little Snitch's UI.
export class NetworkRulesPanel extends Panel {
  private rules: NetworkRule[] = [];
  private description = '';
  private sourcePath = '';
  private loadError: string | null = null;

  constructor() {
 super({
 id: 'network-rules',
 title: 'Network Rules',
 showCount: true,
 trackActivity: false,
 infoTooltip: 'Little Snitch allow rules bundled with Crystal Ball — every outbound endpoint the app needs to reach.',
 });
 this.showLoading('Loading network rules…');
 // Defer refresh out of the constructor so the no-async-constructor rule
 // is satisfied and the panel mounts before any fetch completes.
 setTimeout(() => { void this.refresh(); }, 0);
  }

  async refresh(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/littlesnitch-rules`);
 if (!res.ok) {
 this.loadError = `Sidecar returned HTTP ${res.status}`;
 this.render();
 return;
 }
 const data = (await res.json()) as NetworkRulesetResponse;
 if (data.error) {
 this.loadError = data.error;
 this.render();
 return;
 }
 this.rules = Array.isArray(data.rules) ? data.rules : [];
 this.description = data.description ?? '';
 this.sourcePath = data.sourcePath ?? '';
 this.loadError = null;
 this.setCount(this.rules.length);
 this.render();
 } catch (error) {
 this.loadError = error instanceof Error ? error.message : String(error);
 this.render();
 }
  }

  private groupByCategory(): Map<string, NetworkRule[]> {
 const groups = new Map<string, NetworkRule[]>();
 for (const rule of this.rules) {
 const category = this.categoryFor(rule);
 if (!groups.has(category)) groups.set(category, []);
 groups.get(category)!.push(rule);
 }
 return groups;
  }

  // Group rules into intuitive buckets keyed off note text and remote-host.
  // Falls back to "Other" so unrecognized hosts still render.
  private categoryFor(rule: NetworkRule): string {
 const note = rule.notes.toLowerCase();
 const host = rule.host.toLowerCase();
 if (host === '127.0.0.1' || note.includes('sidecar') || note.includes('cb-control')) return 'Local services';
 if (note.includes('llm') || /(anthropic|groq|openrouter)/.test(host)) return 'LLM APIs';
 if (note.includes('map') || /(mapbox|maptiler|cesium|gibs|openstreetmap)/.test(host)) return 'Maps & tiles';
 if (note.includes('threat') || note.includes('cyber') || /(abuseipdb|greynoise|urlhaus|virustotal|otx|threatfox)/.test(host)) return 'Threat intel';
 if (note.includes('aviation') || note.includes('ads-b') || /(opensky|wingbits|aviationstack|adsb|airplanes\.live|icao)/.test(host)) return 'Aviation';
 if (note.includes('weather') || note.includes('hazard') || /(weather|nasa|noaa|nws|gibs|owm|firms)/.test(host)) return 'Weather & hazard';
 if (note.includes('news') || note.includes('rss') || /(google|bbc|reuters|mediastack|newsapi|newsdata)/.test(host)) return 'News & RSS';
 if (note.includes('economic') || note.includes('finance') || /(fred|eia|finnhub|fmp|stlouisfed)/.test(host)) return 'Economic & financial';
 if (note.includes('sanction') || host.includes('opensanctions')) return 'Sanctions';
 return 'Other';
  }

  private render(): void {
 if (this.loadError) {
 this.setContent(`<div class="net-rules-error" style="padding:12px;color:#ff6b6b;font-size:13px">
 <strong>Could not load network rules.</strong><br/>
 ${escapeHtml(this.loadError)}<br/>
 <span style="opacity:0.7">The bundled file lives at <code>tools/littlesnitch/crystal-ball.lsrules</code> in the repo.</span>
 </div>`);
 return;
  }
 if (this.rules.length === 0) {
 this.setContent('<div style="padding:12px;opacity:0.6;font-size:13px">No rules in the bundled ruleset.</div>');
 return;
 }
 const groups = this.groupByCategory();
 const categoryOrder = ['Local services', 'LLM APIs', 'Maps & tiles', 'Aviation', 'Weather & hazard', 'Threat intel', 'News & RSS', 'Economic & financial', 'Sanctions', 'Other'];
 const sortedKeys = [...groups.keys()].sort((a, b) => {
 const ai = categoryOrder.indexOf(a);
 const bi = categoryOrder.indexOf(b);
 return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
 });
 const sections = sortedKeys.map(category => {
 const list = groups.get(category)!;
 const rows = list.map(rule => `
 <tr>
 <td style="padding:4px 8px;font-family:ui-monospace,monospace;font-size:11px">${escapeHtml(rule.host || rule.process)}</td>
 <td style="padding:4px 8px;text-align:right;opacity:0.6;font-size:11px">${escapeHtml(rule.ports || '—')}/${escapeHtml(rule.protocol || 'tcp')}</td>
 <td style="padding:4px 8px;font-size:11px;opacity:0.85">${escapeHtml(rule.notes || '')}</td>
 </tr>`).join('');
 return `
 <details class="net-rules-section" open style="margin-bottom:8px;border:1px solid var(--panel-border,#2a2a2c);border-radius:6px;overflow:hidden">
 <summary style="padding:6px 10px;background:rgba(255,255,255,0.04);cursor:pointer;font-weight:600;font-size:12px;display:flex;justify-content:space-between">
 <span>${escapeHtml(category)}</span>
 <span style="opacity:0.5;font-weight:normal">${list.length}</span>
 </summary>
 <table style="width:100%;border-collapse:collapse;font-size:11px;background:transparent">
 ${rows}
 </table>
 </details>`;
 }).join('');
 const headerNote = this.description ? `<div style="padding:6px 10px 0 10px;opacity:0.7;font-size:11px">${escapeHtml(this.description)}</div>` : '';
 const sourceLine = this.sourcePath
 ? `<div style="padding:8px 10px 4px 10px;font-size:10px;opacity:0.5;font-family:ui-monospace,monospace">Source: ${escapeHtml(this.sourcePath)}</div>`
 : '';
 this.setContent(`${headerNote}${sourceLine}<div style="padding:8px 10px">${sections}</div>`);
  }
}
