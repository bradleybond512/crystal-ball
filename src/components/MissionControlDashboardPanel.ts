/**
 * MissionControlDashboardPanel — the unified "war room" at-a-glance
 * view. Hero pulse score, situation badges, world-narrative headline,
 * top situations, feed health bar, upcoming events countdown, system
 * health score, and a Refresh button.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMissionControlDashboardService,
  type MissionControlDashboardService,
  type MissionControlSnapshot,
  type MissionControlSources,
  type MissionControlSituationSnapshot,
  type MissionControlCalendarEntryRendered,
  type MissionControlFeedSnapshot,
} from '@/services/intelligence/mission-control-dashboard';
import { getCivilizationPulseEngine } from '@/services/intelligence/civilization-pulse';
import { getWorldNarrativeEngine } from '@/services/intelligence/world-narrative';
import { getSituationStoreV2 } from '@/services/intelligence/situation-store-v2';
import { getFeedWatchdogService } from '@/services/intelligence/feed-watchdog';
import { getTemporalAnomalyDetectorService } from '@/services/intelligence/temporal-anomaly-detector';
import { getGeopoliticalEventCalendar } from '@/services/intelligence/geopolitical-event-calendar';
import { getCrisisSignatureLibrary } from '@/services/intelligence/crisis-signature';

const REFRESH_MS = 30_000;
const UPCOMING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const PULSE_LABEL_COLOR: Record<string, string> = {
  nominal: 'var(--severity-ok, #4ade80)',
  elevated: 'var(--severity-medium, #facc15)',
  stressed: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--severity-critical, #ef4444)',
  high: 'var(--severity-high, #fb923c)',
  medium: 'var(--severity-medium, #facc15)',
  low: 'var(--severity-low, #60a5fa)',
};

export class MissionControlDashboardPanel extends Panel {
  private readonly service: MissionControlDashboardService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'mission-control-dashboard',
      title: 'Mission Control',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Unified command view — civilization pulse, situation roll-ups, world narrative, feed health, anomalies, upcoming events, and crisis signature matches in one snapshot.',
    });
    this.service = getMissionControlDashboardService(liveSources());
    this.start();
  }

  private start(): void {
    if (this.service.getLatest() === null) this.service.refresh();
    this.render();
    this.refreshTimer = setInterval(() => {
      this.service.refresh();
      this.render();
    }, REFRESH_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const snap = this.service.getLatest();
      this.setCount(snap ? snap.activeSituationCount : 0);
      this.setContent(this.buildHtml(snap), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Mission Control panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(snap: MissionControlSnapshot | null): string {
    if (!snap) {
      return `<div style="padding:24px 16px;text-align:center;color:var(--text-secondary,#aaa);font-size:12px;">
        Loading mission control snapshot…
        <div style="margin-top:12px;"><button class="mc-refresh" style="font-size:11px;padding:4px 12px;background:var(--severity-ok,#4ade80);color:#000;border:none;border-radius:3px;cursor:pointer;font-weight:600;">Refresh</button></div>
      </div>`;
    }
    return `${renderControls(snap)}
      <div style="padding:14px 16px;max-height:560px;overflow:auto;">
        ${renderHero(snap)}
        ${renderHealthBar(snap)}
        ${renderNarrative(snap)}
        ${renderTopSituations(snap)}
        ${renderFeedHealth(snap)}
        ${renderAnomalies(snap)}
        ${renderUpcoming(snap)}
        ${renderSignatures(snap)}
      </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const refreshBtn = root.querySelector<HTMLButtonElement>('.mc-refresh');
    refreshBtn?.addEventListener('click', () => {
      this.service.refresh();
      this.render();
    });
  }
}

function liveSources(): MissionControlSources {
  return {
    getPulse: () => {
      const reading = getCivilizationPulseEngine().getLatestReading();
      if (!reading) return null;
      return {
        overallScore: reading.overallScore,
        label: reading.label,
        dominantStressor: reading.dominantStressor,
      };
    },
    getSituations: () => {
      const store = getSituationStoreV2();
      const sits = store.list();
      return sits.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        severity: s.severity,
        status: s.status,
        summary: s.summary,
        confidence: s.confidence,
      }));
    },
    getNarrative: () => {
      const narrative = getWorldNarrativeEngine().getLatestNarrative();
      if (!narrative) return null;
      return { headline: narrative.headline, executiveSummary: narrative.executiveSummary };
    },
    getFeedHealth: () => getFeedWatchdogService().getSummary(),
    getAnomalySummary: () => getTemporalAnomalyDetectorService().getSummary(),
    getUpcomingEvents: () => {
      const events = getGeopoliticalEventCalendar().getUpcoming(UPCOMING_WINDOW_MS);
      return events.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        scheduledAt: e.scheduledAt,
        riskLevel: e.riskLevel,
        country: e.country,
        region: e.region,
      }));
    },
    getRecentSignatureMatches: () => {
      const matches = getCrisisSignatureLibrary().getRecentMatches(5);
      return matches.map((m) => ({
        signatureId: m.signatureId,
        signatureName: m.signatureName,
        confidence: m.confidence,
        matchScore: m.matchScore,
      }));
    },
  };
}

function renderControls(snap: MissionControlSnapshot): string {
  const generated = new Date(snap.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
    <div style="font-size:10px;color:var(--text-secondary,#888);font-family:ui-monospace,monospace;">Last refreshed: ${escapeHtml(generated)}</div>
    <button class="mc-refresh" style="font-size:11px;padding:4px 12px;background:var(--severity-ok,#4ade80);color:#000;border:none;border-radius:3px;cursor:pointer;font-weight:600;">Refresh</button>
  </div>`;
}

function renderHero(snap: MissionControlSnapshot): string {
  const score = snap.civilizationScore;
  const label = snap.civilizationLabel;
  const scoreText = score === null ? '—' : `${score}`;
  const labelText = label ?? 'unavailable';
  const labelColor = label ? PULSE_LABEL_COLOR[label] ?? 'var(--text-secondary,#aaa)' : 'var(--text-secondary,#aaa)';
  const dominant = snap.dominantStressor ? `<span style="color:var(--text-secondary,#888);font-size:11px;">(dominant: ${escapeHtml(snap.dominantStressor)})</span>` : '';
  return `<section style="display:flex;gap:18px;align-items:center;margin-bottom:18px;">
    <div style="text-align:center;min-width:120px;">
      <div style="font-size:48px;font-weight:700;line-height:1;color:${labelColor};">${scoreText}</div>
      <div style="font-size:10px;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">Pulse</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:18px;font-weight:700;text-transform:capitalize;color:${labelColor};">${escapeHtml(labelText)}</div>
      <div style="margin-top:4px;">${dominant}</div>
      ${renderBadges(snap)}
    </div>
  </section>`;
}

function renderBadges(snap: MissionControlSnapshot): string {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
    ${renderBadge('Active', snap.activeSituationCount, 'var(--severity-medium,#facc15)')}
    ${renderBadge('Critical', snap.criticalSituationCount, 'var(--severity-critical,#ef4444)')}
    ${renderBadge('Anomalies', snap.anomalyCount, 'var(--severity-high,#fb923c)')}
    ${renderBadge('Upcoming', snap.upcomingEventsCount, 'var(--accent,#60a5fa)')}
  </div>`;
}

function renderBadge(label: string, value: number, color: string): string {
  return `<div style="padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid ${color};border-radius:12px;font-size:11px;">
    <span style="color:${color};font-weight:700;">${value}</span>
    <span style="color:var(--text-secondary,#aaa);"> ${escapeHtml(label)}</span>
  </div>`;
}

function healthColor(score: number): string {
  if (score >= 75) return 'var(--severity-ok,#4ade80)';
  if (score >= 50) return 'var(--severity-medium,#facc15)';
  if (score >= 25) return 'var(--severity-high,#fb923c)';
  return 'var(--severity-critical,#ef4444)';
}

function renderHealthBar(snap: MissionControlSnapshot): string {
  const score = snap.systemHealthScore;
  const color = healthColor(score);
  return `<section style="margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">
      <span>System Health</span>
      <span style="color:${color};font-weight:700;">${score}/100</span>
    </div>
    <div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${score}%;background:${color};transition:width 0.3s;"></div>
    </div>
  </section>`;
}

function renderNarrative(snap: MissionControlSnapshot): string {
  if (!snap.narrativeHeadline && !snap.narrativeSummary) {
    return `<section style="margin-bottom:16px;">
      <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">World Narrative</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(no narrative available)</div>
    </section>`;
  }
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">World Narrative</h3>
    ${snap.narrativeHeadline ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escapeHtml(snap.narrativeHeadline)}</div>` : ''}
    ${snap.narrativeSummary ? `<div style="font-size:11px;line-height:1.5;color:var(--text-secondary,#ccc);">${escapeHtml(snap.narrativeSummary)}</div>` : ''}
  </section>`;
}

function renderTopSituations(snap: MissionControlSnapshot): string {
  if (snap.topSituations.length === 0) {
    return `<section style="margin-bottom:16px;">
      <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Top Situations</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(no active situations)</div>
    </section>`;
  }
  const rows = snap.topSituations.map((s) => renderSituationRow(s)).join('');
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Top Situations</h3>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${rows}</ul>
  </section>`;
}

function renderSituationRow(s: MissionControlSituationSnapshot): string {
  const color = SEVERITY_COLOR[s.severity] ?? 'var(--text-secondary,#888)';
  return `<li style="padding:6px 10px;background:rgba(255,255,255,0.03);border-left:3px solid ${color};border-radius:3px;">
    <div style="display:flex;gap:8px;align-items:baseline;">
      <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:${color};">[${escapeHtml(s.severity)}]</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(s.name)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#888);">— ${escapeHtml(s.domain)} (${escapeHtml(s.status)})</span>
    </div>
    ${s.summary ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(s.summary)}</div>` : ''}
  </li>`;
}

function renderFeedHealth(snap: MissionControlSnapshot): string {
  const fh = snap.feedHealth;
  if (!fh) {
    return `<section style="margin-bottom:16px;">
      <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Feed Health</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(no feed health data)</div>
    </section>`;
  }
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Feed Health</h3>
    ${renderFeedBar(fh)}
    <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
      ${fh.healthy} healthy · ${fh.degraded} degraded · ${fh.stale} stale · ${fh.offline} offline · ${fh.unacknowledgedAlerts} unack alerts
    </div>
  </section>`;
}

function renderFeedBar(fh: MissionControlFeedSnapshot): string {
  const total = Math.max(1, fh.total);
  const seg = (count: number, color: string) => count > 0 ? `<div style="width:${(count / total) * 100}%;background:${color};"></div>` : '';
  return `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,0.05);">
    ${seg(fh.healthy, 'var(--severity-ok,#4ade80)')}
    ${seg(fh.degraded, 'var(--severity-medium,#facc15)')}
    ${seg(fh.stale, 'var(--severity-high,#fb923c)')}
    ${seg(fh.offline, 'var(--severity-critical,#ef4444)')}
  </div>`;
}

function renderAnomalies(snap: MissionControlSnapshot): string {
  if (snap.anomalyCount === 0) return '';
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Temporal Anomalies</h3>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);">
      <strong style="color:var(--severity-high,#fb923c);">${snap.anomalyCount}</strong> detected
      ${snap.anomalyTopDomain ? `· top domain: <strong>${escapeHtml(snap.anomalyTopDomain)}</strong>` : ''}
    </div>
  </section>`;
}

function renderUpcoming(snap: MissionControlSnapshot): string {
  if (snap.upcomingEvents.length === 0) return '';
  const rows = snap.upcomingEvents.slice(0, 4).map((e) => renderUpcomingRow(e)).join('');
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Upcoming Events</h3>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${rows}</ul>
  </section>`;
}

function formatDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function renderUpcomingRow(e: MissionControlCalendarEntryRendered): string {
  const color = SEVERITY_COLOR[e.riskLevel] ?? 'var(--text-secondary,#888)';
  const daysText = formatDays(e.daysUntil);
  return `<li style="display:flex;justify-content:space-between;gap:10px;font-size:11px;padding:3px 0;">
    <span><span style="color:${color};font-weight:700;text-transform:uppercase;font-size:9px;">[${escapeHtml(e.riskLevel)}]</span> ${escapeHtml(e.title)} <span style="color:var(--text-secondary,#888);">— ${escapeHtml(e.country)}</span></span>
    <span style="color:var(--text-secondary,#aaa);font-variant-numeric:tabular-nums;">in ${escapeHtml(daysText)}</span>
  </li>`;
}

function renderSignatures(snap: MissionControlSnapshot): string {
  if (snap.signatureMatches.length === 0) return '';
  const rows = snap.signatureMatches.map((m) => `<li style="font-size:11px;padding:3px 0;color:var(--text-secondary,#aaa);">
    <span style="font-weight:600;color:var(--text-primary,#ddd);">${escapeHtml(m.signatureName)}</span>
    <span style="color:var(--text-secondary,#888);">— ${escapeHtml(m.confidence)} confidence (${m.matchScore.toFixed(2)})</span>
  </li>`).join('');
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Crisis Signature Matches</h3>
    <ul style="margin:0;padding:0;list-style:none;">${rows}</ul>
  </section>`;
}
