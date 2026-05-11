import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

// ── Sidecar response shapes (mirror the engines from PRs #290 + #292) ──

interface AptGroup {
  id: string;
  name: string;
  aliases: string[];
  country: string;
  targetSectors: string[];
  recentTechniques: string[];
  lastActiveDate?: string;
  activityScore: number;
}

interface AptGroupsResponse {
  configured: boolean;
  groups?: AptGroup[];
  error?: string;
  lastUpdated?: string;
}

interface GrayZoneEvent {
  id: string;
  type: string;
  date: string;
  suspectedActor: string;
  targetCountry: string;
  confidence: number;
  severity: string;
  summary: string;
}

interface GrayZoneResponse {
  configured: boolean;
  events?: GrayZoneEvent[];
  error?: string;
}

type TabId = 'apt' | 'grayzone' | 'escalation' | 'ransomware';

interface RansomwareMention {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  createdAt: number;
  score: number;
  comments: number;
  author: string;
  groups: string[];
}

interface RansomwareResponse {
  mentions?: RansomwareMention[];
  groupCounts?: { group: string; count: number }[];
  asOf?: string;
  error?: string;
}
const REFRESH_MS = 5 * 60_000;

// CyberGeoPanel: APT activity table (sorted by score), gray-zone event
// timeline, and great-power escalation meters. Reads from sidecar
// /api/apt-groups + /api/grayzone-events. Both endpoints return
// configured=false until live ingestion lands; the panel renders
// graceful empty states meanwhile.
export class CyberGeoPanel extends Panel {
  private apt: AptGroupsResponse | null = null;
  private grayzone: GrayZoneResponse | null = null;
  private ransomware: RansomwareResponse | null = null;
  private aptError: string | null = null;
  private grayzoneError: string | null = null;
  private ransomwareError: string | null = null;
  private activeTab: TabId = 'apt';
  private refreshTimer: number | null = null;

  constructor() {
 super({
 id: 'cyber-geo',
 title: 'Cyber × Geo',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'APT group activity + great-power gray-zone events. Reads /api/apt-groups and /api/grayzone-events.',
 });
 this.showLoading('Loading cyber × geo…');
 setTimeout(() => { void this.refresh(); }, 0);
 this.refreshTimer = window.setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  override destroy(): void {
 if (this.refreshTimer !== null) {
 window.clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }

  async refresh(): Promise<void> {
 await Promise.all([this.refreshApt(), this.refreshGrayzone(), this.refreshRansomware()]);
  }

  private async refreshRansomware(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/cyber-ransomware-mentions`);
 const body = (await res.json().catch(() => null)) as RansomwareResponse | null;
 if (body) {
 this.ransomware = body;
 this.ransomwareError = body.error ?? null;
 } else {
 this.ransomwareError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.ransomwareError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private async refreshApt(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/apt-groups`);
 const body = (await res.json().catch(() => null)) as AptGroupsResponse | null;
 if (body) {
 this.apt = body;
 this.aptError = null;
 } else {
 this.aptError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.aptError = error instanceof Error ? error.message : String(error);
 }
 this.updateCount();
 this.render();
  }

  private async refreshGrayzone(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/grayzone-events`);
 const body = (await res.json().catch(() => null)) as GrayZoneResponse | null;
 if (body) {
 this.grayzone = body;
 this.grayzoneError = null;
 } else {
 this.grayzoneError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.grayzoneError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private updateCount(): void {
 const aptCount = this.apt?.groups?.filter((g) => g.activityScore >= 60).length ?? 0;
 const gzCount = this.grayzone?.events?.length ?? 0;
 this.setCount(aptCount + gzCount);
  }

  private renderTabs(): string {
 const aptHot = this.apt?.groups?.filter((g) => g.activityScore >= 60).length ?? 0;
 const gzCount = this.grayzone?.events?.length ?? 0;
 const ransomCount = this.ransomware?.mentions?.length ?? 0;
 const tabs: { id: TabId; label: string; count: number }[] = [
 { id: 'apt', label: 'APT Activity', count: aptHot },
 { id: 'grayzone', label: 'Gray Zone', count: gzCount },
 { id: 'escalation', label: 'Escalation', count: countActorsActive(this.grayzone?.events ?? []) },
 { id: 'ransomware', label: 'Ransomware', count: ransomCount },
 ];
 const items = tabs.map((t) => {
 const active = t.id === this.activeTab;
 const bg = active ? 'rgba(255,255,255,0.08)' : 'transparent';
 const border = active ? '#3b82f6' : 'transparent';
 return `<button data-cgeo-tab="${escapeHtml(t.id)}" style="background:${bg};border:none;padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:2px solid ${border}">${escapeHtml(t.label)} <span style="opacity:0.5">${t.count}</span></button>`;
 }).join('');
 return `<div style="display:flex;border-bottom:1px solid var(--panel-border,#2a2a2c);background:rgba(255,255,255,0.02)">${items}</div>`;
  }

  private renderApt(): string {
 if (this.aptError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.aptError)}</div>`;
 if (!this.apt) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.apt.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>APT corpus not yet loaded.</strong><br/>
 Engine ready (MITRE ATT&CK + OTX + CISA KEV/advisories, 23 tests passing). Live ingest follows in a sidecar PR — vendoring the ATT&CK STIX bundle weekly + polling OTX with the existing OTX_API_KEY.
 </div>`;
 }
 const groups = [...(this.apt.groups ?? [])].sort((a, b) => b.activityScore - a.activityScore);
 if (groups.length === 0) return '<div style="padding:12px;opacity:0.6;font-size:12px">No APT groups in corpus.</div>';
 const rows = groups.slice(0, 25).map((g) => renderAptRow(g)).join('');
 const updated = this.apt.lastUpdated ? `<div style="padding:6px 10px;font-size:10px;opacity:0.5">Updated ${escapeHtml(this.apt.lastUpdated)}</div>` : '';
 return `${updated}<table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="background:rgba(255,255,255,0.04);text-align:left;font-size:10px;opacity:0.7"><tr><th style="padding:4px 8px">Score</th><th style="padding:4px 8px">Group</th><th style="padding:4px 8px">Country</th><th style="padding:4px 8px">Last active</th><th style="padding:4px 8px">Sectors</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  private renderGrayzone(): string {
 if (this.grayzoneError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.grayzoneError)}</div>`;
 if (!this.grayzone) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.grayzone.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>Gray zone classifier not yet wired.</strong><br/>
 Engine ready (sanctions / cyber / proxy / disinfo / econ / infra, 23 tests passing). Live wiring follows in a sidecar PR pulling OpenSanctions + CISA + ACLED + GDELT.
 </div>`;
 }
 const events = [...(this.grayzone.events ?? [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
 if (events.length === 0) return '<div style="padding:12px;opacity:0.6;font-size:12px">No gray-zone events recorded.</div>';
 const rows = events.slice(0, 50).map((e) => renderGrayzoneRow(e)).join('');
 return `<div>${rows}</div>`;
  }

  private renderEscalation(): string {
 if (!this.grayzone?.configured) {
 return '<div style="padding:12px;opacity:0.6;font-size:12px;line-height:1.5">Escalation meters depend on gray-zone events. Configure first.</div>';
 }
 const events = this.grayzone.events ?? [];
 const actors: string[] = ['Russia', 'China', 'Iran', 'North Korea', 'United States'];
 const rows = actors.map((actor) => {
 const actorEvents = events.filter((e) => e.suspectedActor === actor);
 const count = actorEvents.length;
 const score = Math.min(100, count * 5);
 const fillColor = scoreColor(score);
 return `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04)"><div style="display:flex;justify-content:space-between;font-size:11px"><strong>${escapeHtml(actor)}</strong><span style="opacity:0.6">${count} events · score ${score}</span></div><div style="height:4px;background:rgba(255,255,255,0.08);margin-top:4px;border-radius:2px;overflow:hidden"><div style="height:100%;width:${score}%;background:${fillColor}"></div></div></div>`;
 }).join('');
 return `<div>${rows}</div>`;
  }

  private renderRansomware(): string {
 if (this.ransomwareError) return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.ransomwareError)}</div>`;
 if (!this.ransomware) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading ransomware mentions…</div>';
 const mentions = this.ransomware.mentions ?? [];
 const groups = this.ransomware.groupCounts ?? [];
 if (mentions.length === 0) {
 return '<div style="padding:12px;opacity:0.6;font-size:12px">No recent ransomware mentions on Reddit (last 24h).</div>';
 }
 const groupChips = renderGroupChips(groups);
 const rows = mentions.slice(0, 25).map((m) => renderRansomwareRow(m)).join('');
 return `<div>${groupChips}<div>${rows}</div></div>`;
  }

  private renderActiveTab(): string {
 if (this.activeTab === 'grayzone') return this.renderGrayzone();
 if (this.activeTab === 'escalation') return this.renderEscalation();
 if (this.activeTab === 'ransomware') return this.renderRansomware();
 return this.renderApt();
  }

  private render(): void {
 const html = `${this.renderTabs()}<div data-cgeo-body>${this.renderActiveTab()}</div>`;
 this.setContent(html);
 const root = document.querySelector<HTMLElement>(`[data-panel-id="${this.getPanelId()}"]`);
 if (root) {
 root.querySelectorAll<HTMLButtonElement>('button[data-cgeo-tab]').forEach((btn) => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-cgeo-tab') as TabId | null;
 if (id) {
 this.activeTab = id;
 this.render();
 }
 });
 });
 }
  }
}

// ── Module-scope helpers ─────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 60) return '#fca5a5';
  if (score >= 30) return '#fde68a';
  return '#86efac';
}

function renderAptRow(g: AptGroup): string {
  const fillColor = scoreColor(g.activityScore);
  const sectors = g.targetSectors.slice(0, 3).join(', ');
  const lastActive = g.lastActiveDate ? new Date(g.lastActiveDate).toLocaleDateString() : '—';
  return `<tr><td style="padding:4px 8px;font-family:ui-monospace,monospace"><span style="color:${fillColor}">${g.activityScore.toFixed(0)}</span></td><td style="padding:4px 8px"><strong>${escapeHtml(g.name)}</strong> <span style="opacity:0.5;font-size:10px">${escapeHtml(g.id)}</span></td><td style="padding:4px 8px;opacity:0.7">${escapeHtml(g.country)}</td><td style="padding:4px 8px;opacity:0.7">${escapeHtml(lastActive)}</td><td style="padding:4px 8px;opacity:0.7">${escapeHtml(sectors)}</td></tr>`;
}

function renderGrayzoneRow(e: GrayZoneEvent): string {
  const date = new Date(e.date).toLocaleDateString();
  const typeColor = colorForEventType(e.type);
  const severityColor = colorForSeverity(e.severity);
  return `<div style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;line-height:1.5"><div style="display:flex;justify-content:space-between"><span><span style="color:${typeColor};font-weight:600">${escapeHtml(e.type)}</span> · ${escapeHtml(e.suspectedActor)} → ${escapeHtml(e.targetCountry)}</span><span style="opacity:0.6">${escapeHtml(date)} · <span style="color:${severityColor}">${escapeHtml(e.severity)}</span></span></div><div style="opacity:0.85;margin-top:2px">${escapeHtml(e.summary)}</div></div>`;
}

function colorForEventType(type: string): string {
  switch (type) {
    case 'sanctions': { return '#fde68a';
    }
    case 'cyber_attack': { return '#fca5a5';
    }
    case 'proxy_warfare': { return '#f87171';
    }
    case 'disinformation': { return '#a78bfa';
    }
    case 'economic_coercion': { return '#fbbf24';
    }
    case 'infrastructure_sabotage': { return '#ef4444';
    }
    default: { return '#9ca3af';
    }
  }
}

function colorForSeverity(severity: string): string {
  switch (severity) {
    case 'critical': { return '#ef4444';
    }
    case 'high': { return '#fca5a5';
    }
    case 'medium': { return '#fde68a';
    }
    default: { return '#9ca3af';
    }
  }
}

function renderGroupChips(groups: readonly { group: string; count: number }[]): string {
  if (groups.length === 0) {
    return '<div style="font-size:11px;opacity:0.6;padding:6px 10px;">No recognized group names in current mention set.</div>';
  }
  const chips = groups.map((g) => {
    const label = `${escapeHtml(g.group)} · ${g.count}`;
    return `<span style="display:inline-block;padding:2px 8px;border:1px solid #fca5a5;border-radius:8px;font-size:10px;color:#fca5a5;">${label}</span>`;
  }).join('');
  return `<div style="padding:8px 10px;display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>`;
}

function renderGroupBadges(groups: readonly string[]): string {
  if (groups.length === 0) return '';
  const inner = groups.map((g) => `<span style="color:#fca5a5;font-weight:600;">${escapeHtml(g)}</span>`).join(' · ');
  return ` <span style="margin-left:6px;">${inner}</span>`;
}

function renderRansomwareRow(m: RansomwareMention): string {
  const ageHours = Math.max(0, Math.round((Date.now() / 1000 - m.createdAt) / 3600));
  const ageStr = ageHours < 24 ? `${ageHours}h ago` : `${Math.round(ageHours / 24)}d ago`;
  const groupBadges = renderGroupBadges(m.groups);
  return `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" style="display:block;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;color:inherit;text-decoration:none;line-height:1.4;">
    <div><strong>${escapeHtml(m.title.slice(0, 200))}</strong>${groupBadges}</div>
    <div style="opacity:0.6;font-size:10px;margin-top:2px;">r/${escapeHtml(m.subreddit)} · ${escapeHtml(m.author)} · ${ageStr} · ${m.score} pts · ${m.comments} comments</div>
  </a>`;
}

function countActorsActive(events: readonly GrayZoneEvent[]): number {
  const set = new Set<string>();
  for (const e of events) {
    if (e.suspectedActor && e.suspectedActor !== 'Unknown') set.add(e.suspectedActor);
  }
  return set.size;
}
