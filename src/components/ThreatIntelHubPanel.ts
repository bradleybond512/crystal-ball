import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable, setSecretValue } from '@/services/runtime-config';
import type { RuntimeSecretKey } from '@/services/runtime-config';
import type { GreyNoiseResult, OtxPulse, AbuseIpEntry, UrlscanResult } from '@/services/osint/threat-intel';
import { HUMAN_LABELS, SIGNUP_URLS } from '@/services/settings-constants';

const SECTION_HEADING_STYLE = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 6px;';

function sectionError(_label: string, keyName: string): string {
  const humanLabel = HUMAN_LABELS[keyName as RuntimeSecretKey] ?? keyName;
  const signupUrl = SIGNUP_URLS[keyName as RuntimeSecretKey];
  const signupLink = signupUrl ? ` <a href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener" style="color:var(--accent-color);text-decoration:underline;">Get key</a>` : '';
  const inputId = `threat-hub-key-${keyName}`;
  return `<div style="padding:8px;font-size:11px;border:1px dashed var(--border-subtle);border-radius:4px;margin-bottom:8px;">
 <div style="color:var(--text-muted);margin-bottom:6px;">${escapeHtml(humanLabel)} required${signupLink}</div>
 <div style="display:flex;gap:4px;align-items:center;">
 <input id="${inputId}" type="password" placeholder="Paste ${escapeHtml(keyName)}" autocomplete="off" spellcheck="false"
 style="flex:1;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:4px 6px;font-size:11px;" />
 <button data-key="${escapeHtml(keyName)}" data-input="${inputId}"
 style="background:var(--accent-color);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;">Save</button>
 </div>
  </div>`;
}

export class ThreatIntelHubPanel extends Panel {
  constructor() {
 super({
 id: 'threat-intel-hub',
 title: 'Threat Intel Hub',
 showCount: true,
 infoTooltip: 'GreyNoise scanner intelligence, AlienVault OTX pulses, AbuseIPDB blacklist, and URLscan malicious feed.',
 });
 this.showLoading('Loading threat intelligence...');
  }

  public update(data: { greyNoise: GreyNoiseResult[]; otxPulses: OtxPulse[]; abuseIp: AbuseIpEntry[]; urlscan: UrlscanResult[] }): void {
 const { greyNoise, otxPulses, abuseIp, urlscan } = data;

 const totalCount = greyNoise.length + otxPulses.length + abuseIp.length + urlscan.filter(u => u.malicious).length;
 this.setCount(totalCount);

 this.setContent(`<div style="padding:12px;">
 ${this.renderGreyNoise(greyNoise)}
 ${this.renderOtx(otxPulses)}
 ${this.renderAbuseIp(abuseIp)}
 ${this.renderUrlscan(urlscan)}
 </div>`);

 // Wire up inline key-save buttons
 this.getContentElement().querySelectorAll('button[data-key]').forEach(btn => {
 btn.addEventListener('click', () => {
 const button = btn as HTMLButtonElement;
 const keyName = button.dataset.key as RuntimeSecretKey;
 const inputId = button.dataset.input ?? '';
 const input = document.getElementById(inputId) as HTMLInputElement | null;
 const value = input?.value.trim();
 if (!value) return;
 button.disabled = true;
 button.textContent = 'Saving\u2026';
 void setSecretValue(keyName, value).then(() => { window.location.reload(); }).catch(() => {
 button.disabled = false;
 button.textContent = 'Save';
 });
 });
 });
  }

  private renderGreyNoise(results: GreyNoiseResult[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">GreyNoise Scanner Intel</h4>`;

 if (!isFeatureAvailable('greynoiseIntel')) {
 return heading + sectionError('GreyNoise', 'GREYNOISE_API_KEY');
 }

 const counts = { malicious: 0, benign: 0, unknown: 0 };
 for (const r of results) {
 if (r.classification === 'malicious') counts.malicious++;
 else if (r.classification === 'benign') counts.benign++;
 else counts.unknown++;
 }

 const summary = `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">
 <span style="color:#ef4444;">${counts.malicious} malicious</span> · <span style="color:#22c55e;">${counts.benign} benign</span> · <span style="color:#6b7280;">${counts.unknown} unknown</span>
 </div>`;

 const top = results.slice(0, 10);
 if (top.length === 0) {
 return heading + summary + `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">No scanner data available</div>`;
 }

 const rows = top.map(r => {
 const color = r.classification === 'malicious' ? '#ef4444' : r.classification === 'benign' ? '#22c55e' : '#6b7280';
 return `<tr>
 <td style="padding:2px 4px;color:var(--text-primary);">${escapeHtml(r.ip)}</td>
 <td style="padding:2px 4px;color:${color};">${escapeHtml(r.classification)}</td>
 <td style="padding:2px 4px;color:var(--text-secondary);">${escapeHtml(r.name)}</td>
 </tr>`;
 }).join('');

 return `${heading}${summary}<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">
 <thead><tr>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">IP</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">Classification</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">Name</th>
 </tr></thead>
 <tbody>${rows}</tbody>
 </table>`;
  }

  private renderOtx(pulses: OtxPulse[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">OTX Pulses</h4>`;

 if (!isFeatureAvailable('alienvaultOtxThreatIntel')) {
 return heading + sectionError('OTX', 'OTX_API_KEY');
 }

 const top = pulses.slice(0, 8);
 if (top.length === 0) {
 return heading + `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">No OTX pulses available</div>`;
 }

 const items = top.map(pulse =>
 `<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle);">
 <span style="font-size:12px;color:var(--text-primary);">${escapeHtml(pulse.name)}</span>
 <span style="font-size:10px;color:var(--text-muted);">${escapeHtml(pulse.author_name)} · ${pulse.indicators_count} IOCs</span>
 </div>`
 ).join('');

 return `${heading}<div style="margin-bottom:8px;">${items}</div>`;
  }

  private renderAbuseIp(entries: AbuseIpEntry[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">AbuseIPDB Blacklist</h4>`;

 if (!isFeatureAvailable('abuseIpdbThreatIntel')) {
 return heading + sectionError('AbuseIPDB', 'ABUSEIPDB_API_KEY');
 }

 const top = [...entries].sort((a, b) => b.abuseConfidenceScore - a.abuseConfidenceScore).slice(0, 10);
 if (top.length === 0) {
 return heading + `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">No AbuseIPDB entries available</div>`;
 }

 const rows = top.map(entry => {
 const scoreColor = entry.abuseConfidenceScore > 75 ? '#ef4444' : 'var(--text-primary)';
 return `<tr>
 <td style="padding:2px 4px;color:var(--text-primary);">${escapeHtml(entry.ipAddress)}</td>
 <td style="padding:2px 4px;color:${scoreColor};">${entry.abuseConfidenceScore}</td>
 <td style="padding:2px 4px;color:var(--text-secondary);">${escapeHtml(entry.countryCode)}</td>
 </tr>`;
 }).join('');

 return `${heading}<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">
 <thead><tr>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">IP</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">Score</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;">Country</th>
 </tr></thead>
 <tbody>${rows}</tbody>
 </table>`;
  }

  private renderUrlscan(results: UrlscanResult[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">URLscan Malicious Feed</h4>`;

 const malicious = results.filter(r => r.malicious).slice(0, 10);
 if (malicious.length === 0) {
 return heading + `<div style="font-size:11px;color:var(--text-muted);">No recent malicious scans</div>`;
 }

 const items = malicious.map(r => {
 const domain = r.domain ?? r.url ?? '—';
 const country = r.country ?? '—';
 return `<div style="padding:3px 0;border-bottom:1px solid var(--border-subtle);font-size:11px;display:flex;gap:6px;align-items:baseline;">
 <span style="color:var(--text-primary);flex:1;">${escapeHtml(domain)}</span>
 <span style="color:var(--text-muted);">${escapeHtml(country)}</span>
 <span style="color:#ef4444;">${r.score}</span>
 </div>`;
 }).join('');

 return `${heading}<div>${items}</div>`;
  }
}
