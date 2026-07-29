/**
 * Command Center Panel — gameplan's "Mission Control UI" (Big Bet 5).
 *
 * Top-of-app surface that answers: what's the current risk, what
 * matters most, what changed since last look, what to watch next.
 * Reads from the diagnostics registries + provided sentinel feed
 * snapshots — pure composition over the foundation modules.
 */

import { Panel } from './Panel';
import {
  attachDisclosureClickDelegation,
  renderDisclosureSwitcherHtml,
} from './DisclosureContainer';
import { disclosureService } from '@/services/ui/progressive-disclosure';
import {
  getFeatureHealthRegistry,
  getFeedSentinels,
} from '@/services/diagnostics/diagnostics-state';
import {
  aggregateSystemHealth,
  contextFromSnapshots,
} from '@/services/diagnostics/system-health';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { auditFeeds } from '@/services/diagnostics/sentinel-feed-audit';
import {
  getActiveActionBrief,
  getActiveSituation,
  getPersonalImpactReport,
  getProviderRedundancyReport,
  getRecentEvents,
} from '@/services/insights/insights-state';
import type { ActionBrief } from '@/services/insights/action-briefs';
import { askLive } from '@/services/insights/ask-context';
import type { AnswerPacket } from '@/services/insights/ask-the-data';
import {
  ASK_SUGGESTED_QUESTIONS,
  buildAskAnswerHtml,
  buildAskFollowupChipHtml,
} from './ask-the-data-view';
import type { PersonalImpact } from '@/services/personal/personal-impact';
import type { FeatureHealth, HealthStatus } from '@/services/diagnostics/system-health-types';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildCalibrationReportCard,
  type CalibrationDomainRow,
  type CalibrationReliabilityLabel,
} from '@/services/cognition/calibration-report-view';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';
import { getSavedPlaces, type SavedPlace } from '@/services/saved-places';
import type { ImpactSeverity } from '@/services/personal/personal-impact';
import { getActive as getActiveSituations } from '@/services/intelligence/situation-store';
import {
  defaultLayout,
  loadLayout,
  reconcileLayout,
  reorderLayout,
  saveLayout,
  clearLayout,
  type TileConfig,
} from '@/services/command-center/layout-persistence';
import {
  formatDelta,
  getWhatChanged,
  recordSnapshot,
  type AlertSeverityLike,
  type AlertState,
  type ChangeDomain,
  type FeedHealthLike,
  type FeedState,
  type SituationState,
  type WhatChangedEvent,
} from '@/services/command-center/what-changed';
import { loadRules } from '@/services/intelligence/rules-engine';
import {
  buildCommandCenterSummary,
  buildSituationTimeline,
  type CommandCenterSummary,
  type SituationSummary,
  type WhatChangedItem,
  type FeedHealth,
  type SuggestedAction,
} from '@/services/intelligence/command-center-summary';
import { mountLensBanner } from '@/services/intelligence/panel-lens-adapter';
import { getLensContextService } from '@/services/intelligence/lens-context';
import { buildShareBriefing, type ShareBriefingInput } from './share-briefing';
import { buildSharePacket, selectFormat } from '@/services/insights/share-packet';
import { allGuides, getGuide } from '@/services/survival-guide/guide-library';
import { getCheckedIds, subscribe as subscribeChecklist } from '@/services/survival-guide/checklist-store';
import { computeOverallReadiness } from '@/services/survival-guide/readiness-score';
import { guidesForPlaybookCategory } from '@/services/survival-guide/guide-links';

const REFRESH_MS = 10_000;

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: 'var(--severity-ok)',
  degraded: 'var(--severity-medium)',
  stale:   'var(--severity-high)',
  failing: 'var(--severity-high)',
  unsafe:  'var(--severity-critical)',
  blind:   'var(--severity-info)',
  unknown: 'var(--severity-info)',
};

const ACTION_TIER_COLOR: Record<'monitor' | 'prepare' | 'act_now' | 'shelter', string> = {
  monitor: 'var(--severity-ok)',
  prepare: 'var(--severity-medium)',
  act_now: 'var(--severity-high)',
  shelter: 'var(--severity-critical)',
};

const IMPACT_SEVERITY_COLOR: Record<'critical' | 'elevated' | 'watch' | 'low' | 'none', string> = {
  critical: 'var(--severity-critical)',
  elevated: 'var(--severity-high)',
  watch:    'var(--severity-medium)',
  low:      'var(--severity-info)',
  none:     'var(--severity-info)',
};

const RISK_LABEL: Record<HealthStatus, string> = {
  healthy: 'CALM',
  unknown: 'WARMING',
  degraded: 'ELEVATED',
  stale: 'STALE',
  blind: 'BLIND',
  failing: 'STRESSED',
  unsafe: 'CRITICAL',
};

const CALIBRATION_TONE: Record<CalibrationReliabilityLabel, string> = {
  well_calibrated: 'var(--severity-ok, #3fb950)',
  overconfident: 'var(--severity-medium, #ff9f0a)',
  underconfident: 'var(--severity-info, #0a84ff)',
  insufficient_data: 'var(--text-secondary, #8a8a8e)',
};

const CALIBRATION_LABEL_TEXT: Record<CalibrationReliabilityLabel, string> = {
  well_calibrated: 'calibrated',
  overconfident: 'runs hot',
  underconfident: 'runs cold',
  insufficient_data: 'building',
};

const WHAT_CHANGED_WINDOW_MS = 60 * 60 * 1000;
const TAPE_REFRESH_MS = 60 * 1000;

export class CommandCenterPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private tapeTimer: ReturnType<typeof setInterval> | null = null;
  private tapeEvents: WhatChangedEvent[] = [];
  private expandedTapeEventId: string | null = null;
  private isDragging = false;
  private draggingId: string | null = null;
  private dragOverId: string | null = null;
  private boundPointerMove: ((e: MouseEvent) => void) | null = null;
  private boundPointerUp: ((e: MouseEvent) => void) | null = null;
  private boundEscape: ((e: KeyboardEvent) => void) | null = null;
  private detachDisclosure: (() => void) | null = null;
  private unsubscribeDisclosure: (() => void) | null = null;
  private detachLensBanner: (() => void) | null = null;
  private unsubscribeLens: (() => void) | null = null;
  private unsubscribeChecklist: (() => void) | null = null;
  // Ask-the-data state lives in class fields so the 10 s re-render
  // doesn't wipe the typed question or the last answer.
  private askDraft = '';
  private askPacket: AnswerPacket | null = null;
  private _briefingInput: ShareBriefingInput | null = null;

  constructor() {
    super({
      id: 'command-center',
      title: 'Command Center',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Top-of-app summary: current risk, what matters most, what changed, what to watch next. Reads from feature / panel / notification registries.',
    });
    this.start();
  }

  private start(): void {
    this.refreshChangeTape();
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.tapeTimer = setInterval(() => this.refreshChangeTape(), TAPE_REFRESH_MS);
    this.attachInteractionListeners();
    this.detachDisclosure = attachDisclosureClickDelegation(this.content, 'command-center');
    this.unsubscribeDisclosure = disclosureService.subscribe('command-center', () => this.render());
    this.detachLensBanner = mountLensBanner(this.content, 'command-center');
    this.unsubscribeLens = getLensContextService().subscribe(() => this.render());
    this.unsubscribeChecklist = subscribeChecklist(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.tapeTimer !== null) {
      clearInterval(this.tapeTimer);
      this.tapeTimer = null;
    }
    this.detachPointerListeners();
    this.detachDisclosure?.();
    this.detachDisclosure = null;
    this.unsubscribeDisclosure?.();
    this.unsubscribeDisclosure = null;
    this.detachLensBanner?.();
    this.detachLensBanner = null;
    this.unsubscribeLens?.();
    this.unsubscribeLens = null;
    this.unsubscribeChecklist?.();
    this.unsubscribeChecklist = null;
    super.destroy();
  }

  private render(): void {
    if (this.isDragging) return;
    // setContent replaces the DOM — remember whether the ask input held
    // focus so the periodic refresh doesn't steal the caret mid-typing.
    const active = document.activeElement as HTMLInputElement | null;
    const askHadFocus = active?.dataset?.askInput !== undefined;
    const html = this.buildHtml();
    this.setContent(html);
    if (askHadFocus) {
      const input = this.content.querySelector<HTMLInputElement>('[data-ask-input]');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  private buildHtml(): string {
    // Pull live source/provider/sidecar/feed state instead of the empty
    // arrays + hard-coded unknown sidecar that used to drive this panel.
    const snapshot = getLiveDiagnosticsSnapshot();
    const featureReg = getFeatureHealthRegistry();
    const sentinels = getFeedSentinels();

    const panels = snapshot.panels;
    const ctx = contextFromSnapshots({
      panels,
      sources: snapshot.sources,
      providers: snapshot.providers,
    });
    const features = featureReg.all(ctx);
    const report = aggregateSystemHealth({
      panels,
      features,
      sources: snapshot.sources,
      providers: snapshot.providers,
      notifications: snapshot.notificationSummary,
      sidecar: snapshot.sidecar,
    });
    const feedAudit = auditFeeds({ sentinels, snapshots: snapshot.feedSnapshots });

    const concerning = features
      .filter((f) => f.status !== 'healthy' && f.status !== 'unknown')
      .sort((a, b) => criticalRank(b) - criticalRank(a));
    this.setCount(concerning.length);

    const actionBrief = getActiveActionBrief();
    const personalImpact = getPersonalImpactReport();
    const redundancy = getProviderRedundancyReport();

    this._briefingInput = {
      headline: `${RISK_LABEL[report.status]} — ${report.summary}`,
      concerns: concerning.slice(0, 5).map((f) => f.userImpact ? `${f.label}: ${f.userImpact}` : `${f.label} (${f.status})`),
      watch: actionBrief ? [...actionBrief.confirmingSources] : [],
      actions: actionBrief ? [...actionBrief.recommendedActions] : [],
      generatedAt: Date.now(),
    };

    const spineSummary = this.buildSpineSummary(sentinels, snapshot);
    const switcher = renderDisclosureSwitcherHtml('command-center', { showRaw: true });
    const level = disclosureService.getLevel('command-center');

    const switcherRow = `<div style="display:flex;justify-content:flex-end;">${switcher}</div>`;

    if (level === 'raw') {
      const rawBundle = {
        status: report.status,
        summary: report.summary,
        recommendations: report.recommendations,
        concerning: concerning.map((f) => ({ featureId: f.featureId, label: f.label, status: f.status, reason: f.reason })),
        personalImpact: personalImpact.impacts,
        providerRedundancy: redundancy.domains,
        feedAudit: feedAudit.entries,
      };
      return `<div style="padding:14px;display:flex;flex-direction:column;gap:10px;">
        ${switcherRow}
        <pre style="margin:0;padding:10px;font-size:11px;font-family:ui-monospace,monospace;background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle,#333);border-radius:4px;overflow:auto;max-height:520px;">${escapeHtml(JSON.stringify(rawBundle, null, 2))}</pre>
      </div>`;
    }

    if (level === 'summary') {
      return `<div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${switcherRow}
        ${this.renderRiskHeadline(report.status, report.summary)}
        ${this.renderTopThings(concerning.slice(0, 3))}
        ${this.renderReadinessRow()}
      </div>`;
    }

    return `
      <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${switcherRow}
        ${this.renderGlobeNav()}
        ${this.renderChangeTape()}
        ${this.renderFiveQuestionSpine(spineSummary)}
        ${this.renderAskTheData()}
        ${this.renderSavedPlacesTiles()}
        ${this.renderRiskHeadline(report.status, report.summary)}
        ${this.renderActionBrief(actionBrief)}
        ${this.renderPersonalImpact(personalImpact.impacts)}
        ${this.renderTopThings(concerning)}
        ${this.renderReadinessRow()}
        ${this.renderProviderRedundancy(redundancy)}
        ${this.renderCalibrationReport()}
        ${this.renderWatchNext(feedAudit.entries.length, feedAudit.entries.filter((e) => e.level !== 'fresh' && e.level !== 'unknown').length)}
        ${this.renderRecommendations(report.recommendations)}
      </div>
    `;
  }

  /**
   * Compose the 5-question summary from the deterministic builder.
   * `sentinels` and `snapshot` come from the live diagnostics state.
   */
  private buildSpineSummary(
    sentinels: ReturnType<typeof getFeedSentinels>,
    snapshot: ReturnType<typeof getLiveDiagnosticsSnapshot>,
  ): CommandCenterSummary {
    const places = getSavedPlaces();
    const feedLastSeen: Record<string, number> = {};
    const healthyFeedIds: string[] = [];
    // FeedSentinel has no live observation timestamp — it's the
    // configuration row. Health + last-seen come from the source
    // diagnostic registry. Use sentinels purely to enumerate the
    // expected feed set.
    for (const sentinel of sentinels) {
      feedLastSeen[sentinel.feedId] = 0;
    }
    for (const src of snapshot.sources ?? []) {
      const last = typeof src.lastSuccessAt === 'number' ? src.lastSuccessAt : null;
      if (last !== null) feedLastSeen[src.sourceId] = last;
      if (src.status === 'healthy') healthyFeedIds.push(src.sourceId);
    }
    // Strip the placeholder zeros so any feed without a real
    // success-timestamp does not pollute the "lastUpdated" max.
    for (const id of Object.keys(feedLastSeen)) {
      if (feedLastSeen[id] === 0) delete feedLastSeen[id];
    }
    return buildCommandCenterSummary({
      situations: getActiveSituations(),
      whatChangedReport: null,
      savedPlaces: places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon })),
      alertRules: loadRules(),
      topSituationPlaybook: null,
      feedLastSeen,
      healthyFeedIds,
      now: Date.now(),
    });
  }

  private renderFiveQuestionSpine(summary: CommandCenterSummary): string {
    return `<div style="display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--border-subtle,#333);border-radius:6px;background:rgba(255,255,255,0.02);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#aaa);">Command Center · Five questions</div>
      ${this.renderSpineSituations(summary.topSituations)}
      ${this.renderSpineTimeline(summary.topSituations)}
      ${this.renderSpineWhatChanged(summary.whatChanged)}
      ${this.renderSpineFeedHealth(summary.feedHealth)}
      ${this.renderSpineActions(summary.suggestedActions)}
    </div>`;
  }

  private renderSpineSituations(situations: readonly SituationSummary[]): string {
    if (situations.length === 0) {
      return spineSection(
        '1. What matters right now?',
        '<div style="font-size:12px;color:var(--severity-ok);">No active situations.</div>',
      );
    }
    const rows = situations.map((s) => {
      const places = s.nearestPlace
        ? `<span style="margin-left:8px;color:var(--text-secondary,#aaa);font-size:11px;">${escapeHtml(s.nearestPlace.name)} · ${s.nearestPlace.distanceKm} km</span>`
        : '';
      const rules = s.matchingRules.length > 0
        ? `<div style="margin-top:2px;font-size:10px;color:var(--severity-medium);">Rules: ${s.matchingRules.map((name) => escapeHtml(name)).join(', ')}</div>`
        : '';
      return `<div style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.04);">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span style="font-size:14px;">${s.domainIcon}</span>
          <strong style="font-size:13px;">${escapeHtml(s.name)}</strong>
          <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${severityBackground(s.severity)};color:var(--text-on-accent,#000);text-transform:uppercase;">${escapeHtml(s.severity)}</span>
          ${places}
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(s.summary)} · ${s.observationCount} events</div>
        ${rules}
      </div>`;
    }).join('');
    return spineSection('1. What matters right now? (with: why does it matter to me?)', `<div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>`);
  }

  private renderSpineTimeline(situations: readonly SituationSummary[]): string {
    const top = situations[0];
    if (!top) {
      return spineSection('2. How did this develop?', '<div style="font-size:12px;color:var(--text-secondary,#aaa);">No active situation to trace yet.</div>');
    }
    const steps = buildSituationTimeline(top);
    const rows = steps.map((step, idx) => `<li style="font-size:12px;display:flex;gap:6px;align-items:baseline;">
      <span style="color:var(--text-secondary,#aaa);">${idx === steps.length - 1 ? '└' : '├'}</span>
      <strong style="font-size:11px;">${escapeHtml(step.label)}</strong>
      <span style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(step.detail)}</span>
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;font-size:10px;">${timeAgo(step.at)}</span>
    </li>`).join('');
    return spineSection(
      `2. How did this develop? (${escapeHtml(top.name)})`,
      `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;">${rows}</ul>`,
    );
  }

  private renderSpineWhatChanged(items: readonly WhatChangedItem[]): string {
    if (items.length === 0) {
      return spineSection('3. What changed since last look?', '<div style="font-size:12px;color:var(--text-secondary,#aaa);">No what-changed report yet.</div>');
    }
    const rows = items.map((i) => `<li style="font-size:12px;display:flex;gap:6px;">
      <span>${polarityIcon(i.polarity)}</span>
      <span>${escapeHtml(i.label)}</span>
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;font-size:10px;">${timeAgo(i.occurredAt)}</span>
    </li>`).join('');
    return spineSection('3. What changed since last look?', `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;">${rows}</ul>`);
  }

  private renderSpineFeedHealth(health: FeedHealth): string {
    const color = freshnessColor(health.freshness);
    const lastSeen = health.lastUpdated ? timeAgo(health.lastUpdated) : '—';
    return spineSection(
      '4. How confident is Crystal Ball?',
      `<div style="display:flex;align-items:center;gap:8px;">
        <span style="padding:2px 6px;border-radius:3px;background:${color};color:#000;font-size:10px;font-weight:600;">${escapeHtml(health.freshness)}</span>
        <span style="font-size:12px;">${escapeHtml(health.headline)}</span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);margin-left:auto;">last data ${escapeHtml(lastSeen)}</span>
      </div>`,
    );
  }

  private renderSpineActions(actions: readonly SuggestedAction[]): string {
    if (actions.length === 0) {
      return spineSection('5. What should I do next?', '<div style="font-size:12px;color:var(--text-secondary,#aaa);">No suggested actions — add an alert rule to populate this section.</div>');
    }
    const rows = actions.map((a) => `<li style="font-size:12px;display:flex;align-items:center;gap:6px;">
      <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${a.source === 'playbook' ? 'rgba(96,165,250,0.18)' : 'rgba(250,204,21,0.18)'};text-transform:uppercase;">${escapeHtml(a.source)}</span>
      <span>${escapeHtml(a.label)}</span>
      ${a.automated ? '<span style="font-size:10px;color:var(--severity-ok);">·auto</span>' : ''}
    </li>`).join('');
    return spineSection('5. What should I do next?', `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;">${rows}</ul>`);
  }

  // ── Ask the data (deterministic structured query, gap #5) ───────────────

  private renderAskTheData(): string {
    const answerHtml = this.askPacket
      ? buildAskAnswerHtml(this.askPacket)
      : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${ASK_SUGGESTED_QUESTIONS.map((q) => buildAskFollowupChipHtml(q)).join('')}
        </div>`;
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:6px;padding:10px;background:rgba(255,255,255,0.02);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#aaa);margin-bottom:6px;">Ask the data</div>
      <div style="display:flex;gap:6px;">
        <input type="text" data-ask-input placeholder="Why is risk high? What changed? What should I watch?"
          value="${escapeHtml(this.askDraft)}"
          style="flex:1;font-size:12px;padding:5px 8px;border:1px solid var(--border-subtle,#444);border-radius:4px;background:rgba(0,0,0,0.25);color:inherit;" />
        <button type="button" data-action="ask-submit"
          style="font-size:11px;padding:5px 12px;border:1px solid var(--border-subtle,#444);border-radius:4px;background:rgba(74,158,255,0.16);color:inherit;cursor:pointer;">Ask</button>
      </div>
      ${answerHtml}
    </div>`;
  }

  private submitAsk(question: string): void {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    this.askDraft = trimmed;
    this.askPacket = askLive(trimmed);
    this.render();
  }

  private renderGlobeNav(): string {
    return `<div style="display:flex;justify-content:flex-end;gap:6px;">
      <button data-cc-action="copy-briefing" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;" title="Copy this briefing to the clipboard">📋 Copy briefing</button>
      <button onclick="document.getElementById('godsVisionBtn')?.click()" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;" title="Open God's Vision 3D globe">🌍 Globe</button>
    </div>`;
  }

  private renderRiskHeadline(status: HealthStatus, summary: string): string {
    const color = STATUS_COLOR[status];
    const label = RISK_LABEL[status];
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color}aa;"></span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.08em;">Current risk</span>
      </div>
      <div style="font-size:28px;font-weight:800;color:${color};letter-spacing:0.04em;">${escapeHtml(label)}</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(summary)}</div>
    </div>`;
  }

  private renderTopThings(concerning: readonly FeatureHealth[]): string {
    if (concerning.length === 0) {
      return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Top things that matter</div>
        <div style="font-size:13px;color:var(--severity-ok);">All features within their calibration floors. No action needed.</div>
      </div>`;
    }
    const top = concerning.slice(0, 3);
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Top ${top.length} ${top.length === 1 ? 'thing' : 'things'} that matter</div>
      ${top.map((f, i) => this.renderTopRow(f, i + 1)).join('')}
    </div>`;
  }

  private renderTopRow(f: FeatureHealth, n: number): string {
    const color = STATUS_COLOR[f.status];
    return `<div style="display:flex;gap:10px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;margin-bottom:6px;">
      <div style="font-size:18px;font-weight:800;color:${color};min-width:24px;">${n}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(f.label)}</span>
          <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(f.status)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(f.userImpact || f.reason)}</div>
        ${f.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(f.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  private renderWatchNext(totalFeeds: number, drifting: number): string {
    if (totalFeeds === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Watch next</div>
      <div style="font-size:12px;">
        ${drifting === 0
          ? `${totalFeeds} feeds fresh — nothing drifting.`
          : `<strong style="color:var(--severity-high);">${drifting}</strong> of ${totalFeeds} sentinel feeds drifting. See Diagnostic → Feeds.`}
      </div>
    </div>`;
  }

  private renderReadinessRow(): string {
    const started = getCheckedIds().size > 0;
    const overall = computeOverallReadiness(allGuides(), getCheckedIds());
    // Before any item is ticked every guide is 0% and `weakest` is just the
    // first guide — link to the index in that case, not an arbitrary guide.
    const weak = started && overall.weakest ? getGuide(overall.weakest) : null;
    const target = weak ? weak.id : '';
    const weakText = weak ? ` · weakest: ${escapeHtml(weak.title)}` : '';
    return `<button type="button" data-cc-open-guide="${target}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:1px solid var(--border-subtle,#333);border-radius:8px;background:rgba(255,255,255,0.02);color:inherit;cursor:pointer;">
      <span style="font-size:13px;">Preparedness ${overall.percent}%${weakText}</span>
      <span style="opacity:0.6;font-size:12px;">Survival guide ›</span>
    </button>`;
  }

  private renderActionBrief(brief: ActionBrief | undefined): string {
    if (!brief) return '';
    const tierColor = ACTION_TIER_COLOR[brief.tier];
    const actions = brief.recommendedActions.length === 0
      ? ''
      : `<ul style="margin:6px 0 0 0;padding-left:18px;font-size:12px;line-height:1.5;">
          ${brief.recommendedActions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>`;
    const watch = brief.confirmingSources.length === 0
      ? ''
      : `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;">
          <span style="text-transform:uppercase;letter-spacing:0.05em;">Watch next</span> · ${escapeHtml(brief.confirmingSources.slice(0, 4).join(', '))}
        </div>`;
    const situationCat = getActiveSituation()?.category;
    const briefGuideId = situationCat ? guidesForPlaybookCategory(situationCat)[0] : undefined;
    const briefGuide = briefGuideId ? getGuide(briefGuideId) : undefined;
    const guideLink = briefGuide
      ? `<button type="button" data-cc-open-guide="${briefGuide.id}" style="margin-top:8px;font-size:12px;background:transparent;border:none;color:var(--accent,#4a9eff);cursor:pointer;padding:2px 0;">Full guide: ${escapeHtml(briefGuide.title)} →</button>`
      : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${tierColor};border-radius:4px;padding:10px 12px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-weight:700;font-size:13px;">${escapeHtml(brief.headline)}</span>
        <span style="font-size:10px;color:${tierColor};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(brief.tier)}</span>
      </div>
      ${actions}
      ${watch}
      ${guideLink}
    </div>`;
  }

  private renderPersonalImpact(impacts: readonly PersonalImpact[]): string {
    const surfacing = impacts.filter((i) => i.severity !== 'none' && i.severity !== 'low').slice(0, 3);
    if (surfacing.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Your personal impact</div>
      ${surfacing.map((i) => this.renderImpactRow(i)).join('')}
    </div>`;
  }

  private renderImpactRow(i: PersonalImpact): string {
    const color = IMPACT_SEVERITY_COLOR[i.severity];
    const exposures = i.exposures.length === 0
      ? '<em>no direct personal exposure</em>'
      : i.exposures.slice(0, 2).map((e) => escapeHtml(e.label)).join(', ');
    return `<div style="display:flex;gap:10px;padding:6px 0;">
      <span style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;min-width:60px;">${escapeHtml(i.severity)}</span>
      <div style="flex:1;font-size:12px;">
        <div>${escapeHtml(i.description)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${exposures}</div>
        ${i.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(i.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  /**
   * "How well am I forecasting?" — surfaces the Closed Calibration Loop
   * (recalibration.ts) so the recalibration the system applies invisibly
   * becomes legible: which domains run hot/cold, how much resolved history
   * backs each, and whether recalibration is actively engaged. Renders
   * nothing until at least one forecast has resolved.
   */
  private renderCalibrationReport(): string {
    const card = buildCalibrationReportCard(getCalibrationStore().all());
    if (card.overall.resolvedTotal === 0) return '';

    const chip = (label: CalibrationReliabilityLabel): string => {
      const color = CALIBRATION_TONE[label];
      const text = CALIBRATION_LABEL_TEXT[label];
      return `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${color}22;color:${color};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(text)}</span>`;
    };

    const sparkline = (row: CalibrationDomainRow): string => {
      if (row.sparkline.length === 0) return '';
      const cells = row.sparkline.map((pt) => {
        let c = 'var(--severity-ok, #3fb950)';
        if (Math.abs(pt.gap) > 0.05) c = pt.gap < 0 ? 'var(--severity-medium, #ff9f0a)' : 'var(--severity-info, #0a84ff)';
        const title = `predicted ${Math.round(pt.predicted * 100)}% · observed ${Math.round(pt.observed * 100)}% (n=${pt.n})`;
        return `<span title="${escapeHtml(title)}" style="display:inline-block;width:6px;height:10px;background:${c};border-radius:1px;"></span>`;
      }).join('');
      return `<span style="display:inline-flex;gap:2px;align-items:center;margin-left:auto;">${cells}</span>`;
    };

    const rows = card.domains.slice(0, 5).map((row) => {
      const brier = row.brier === null ? '' : ` · Brier ${row.brier.toFixed(2)}`;
      return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <strong style="font-size:12px;">${escapeHtml(row.label)}</strong>
          ${chip(row.reliability)}
          <span style="font-size:10px;color:var(--text-secondary,#888);">n=${row.sampleSize}${escapeHtml(brier)}</span>
          ${sparkline(row)}
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);line-height:1.4;">${escapeHtml(row.headline)}</div>
      </div>`;
    }).join('');

    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;">Forecast calibration</span>
        ${chip(card.overall.label)}
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:6px;line-height:1.4;">${escapeHtml(card.overall.summary)}</div>
      ${rows}
    </div>`;
  }

  private renderProviderRedundancy(report: ReturnType<typeof getProviderRedundancyReport>): string {
    if (report.domains.length === 0) return '';
    // "Verified" = a domain where ≥2 corroborating providers share the same
    // fact fingerprint (the fusion-ingest path lights this up).
    const verified = report.domains
      .filter((d) => d.verdict === 'redundant_agreement')
      .map((d) => ({
        domain: d.domain,
        n: d.providers.filter((p) => p.recentFactFingerprint && (p.level === 'healthy' || p.level === 'degraded')).length,
      }))
      .filter((d) => d.n >= 2);
    const stressed = report.domains.filter((d) => d.verdict !== 'redundant_agreement');
    if (verified.length === 0 && stressed.length === 0) return '';
    const verifiedMargin = stressed.length > 0 ? '8px' : '0';
    const verifiedHtml = verified.length === 0 ? '' : `<div style="font-size:12px;color:var(--ok,#3fb950);line-height:1.5;margin-bottom:${verifiedMargin};">
        ${verified.slice(0, 4).map((d) => `✓ <strong>${escapeHtml(d.domain)}</strong>: verified by ${d.n} independent sources`).join('<br>')}
      </div>`;
    const stressedHtml = stressed.length === 0 ? '' : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${stressed.slice(0, 3).map((d) => `<li><strong>${escapeHtml(d.domain)}</strong>: ${escapeHtml(d.reason)}</li>`).join('')}
      </ul>`;
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Source corroboration</div>
      ${verifiedHtml}${stressedHtml}
    </div>`;
  }

  private renderRecommendations(recs: readonly string[]): string {
    if (recs.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">What you should do</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${recs.slice(0, 4).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // ── Saved-places tiles ──────────────────────────────────────────────────

  /**
   * Read the persisted layout and reconcile it against the current set
   * of saved places so removed places drop out and new ones append.
   */
  private currentLayout(places: readonly SavedPlace[]): TileConfig[] {
    const stored = loadLayout();
    if (stored.length === 0) {
      const fresh = defaultLayout(places);
      saveLayout(fresh);
      return fresh;
    }
    const reconciled = reconcileLayout(stored, places);
    if (reconciled.length !== stored.length) saveLayout(reconciled);
    return reconciled;
  }

  private orderedPlaces(places: readonly SavedPlace[]): SavedPlace[] {
    const layout = this.currentLayout(places);
    const placeMap = new Map(places.map((p) => [p.id, p]));
    const ordered: SavedPlace[] = [];
    for (const tile of layout) {
      if (tile.type !== 'saved-place' || !tile.visible || !tile.placeId) continue;
      const place = placeMap.get(tile.placeId);
      if (place) ordered.push(place);
    }
    return ordered;
  }

  private placeSeverity(place: SavedPlace, impacts: readonly PersonalImpact[]): ImpactSeverity {
    return impacts.find((imp) =>
      imp.exposures.some((e) => e.exposureId === place.id || e.label === place.name),
    )?.severity ?? 'none';
  }

  private topAlertSummary(place: SavedPlace, impacts: readonly PersonalImpact[]): string | null {
    const match = impacts.find((imp) =>
      imp.exposures.some((e) => e.exposureId === place.id || e.label === place.name),
    );
    return match ? match.description : null;
  }

  private placeAlertCount(place: SavedPlace, impacts: readonly PersonalImpact[]): number {
    return impacts.filter((imp) =>
      imp.exposures.some((e) => e.exposureId === place.id || e.label === place.name),
    ).length;
  }

  private renderTile(place: SavedPlace, severity: ImpactSeverity, alertCount: number, topAlert: string | null): string {
    const tileId = `saved-place:${place.id}`;
    const color = IMPACT_SEVERITY_COLOR[severity];
    const plural = alertCount === 1 ? '' : 's';
    const isDragging = this.draggingId === tileId;
    const isDragOver = this.dragOverId === tileId && this.draggingId !== tileId;
    const ring = isDragOver ? 'box-shadow:0 0 0 2px var(--accent,#4a9eff) inset;' : '';
    const dragging = isDragging ? 'opacity:0.55;' : '';
    const topAlertHtml = topAlert
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(topAlert)}">${escapeHtml(topAlert)}</div>`
      : '';
    const countHtml = alertCount > 0
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${alertCount} alert${plural}</div>`
      : '';
    return `<div class="ccp-tile" data-tile-id="${escapeHtml(tileId)}"
      style="flex:0 0 auto;width:120px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-top:3px solid ${color};border-radius:4px;cursor:grab;background:rgba(255,255,255,0.02);user-select:none;${ring}${dragging}">
      <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</div>
      <div style="font-size:10px;color:${color};text-transform:uppercase;margin-top:2px;">${escapeHtml(severity)}</div>
      ${topAlertHtml}
      ${countHtml}
    </div>`;
  }

  private renderSavedPlacesTiles(): string {
    const places = getSavedPlaces().slice(0, 6);
    const impacts = getPersonalImpactReport().impacts;
    const ordered = this.orderedPlaces(places);
    const tileHtml = ordered.map((p) =>
      this.renderTile(
        p,
        this.placeSeverity(p, impacts),
        this.placeAlertCount(p, impacts),
        this.topAlertSummary(p, impacts),
      ),
    ).join('');
    const addBtn = `<button data-action="add-place" style="font-size:11px;color:var(--accent,#4a9eff);background:none;border:1px dashed var(--border-subtle,#333);border-radius:4px;padding:6px 10px;cursor:pointer;align-self:flex-start;" title="Add a saved place">+</button>`;
    const resetBtn = `<button data-action="reset-layout" style="font-size:10px;color:var(--text-secondary,#aaa);background:none;border:none;cursor:pointer;text-decoration:underline;" title="Restore default tile order">Reset layout</button>`;
    return `<div style="padding-bottom:2px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;">Your places</div>
        ${resetBtn}
      </div>
      <div class="ccp-tiles-row" style="display:flex;flex-wrap:wrap;gap:8px;">${tileHtml}${addBtn}</div>
    </div>`;
  }

  // ── Drag-to-reorder + click handlers ────────────────────────────────────

  private attachInteractionListeners(): void {
    this.content.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.content.addEventListener('click', (e) => this.onContentClick(e));
    // Keep the ask draft in sync so the 10 s re-render can restore it.
    this.content.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | null;
      if (target?.dataset?.askInput !== undefined) this.askDraft = target.value;
    });
    this.content.addEventListener('keydown', (e) => {
      const target = e.target as HTMLInputElement | null;
      if (target?.dataset?.askInput !== undefined && e.key === 'Enter') {
        this.submitAsk(target.value);
      }
    });
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-tile-id]');
    if (!tile) return;
    e.preventDefault();
    this.isDragging = true;
    this.draggingId = tile.dataset.tileId ?? null;
    this.dragOverId = this.draggingId;
    this.boundPointerMove = (ev) => this.onPointerMove(ev);
    this.boundPointerUp = () => this.onPointerUp();
    this.boundEscape = (ev) => { if (ev.key === 'Escape') this.cancelDrag(); };
    window.addEventListener('mousemove', this.boundPointerMove);
    window.addEventListener('mouseup', this.boundPointerUp);
    window.addEventListener('keydown', this.boundEscape);
    this.applyDragVisualState();
  }

  private onPointerMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tile = el?.closest<HTMLElement>('[data-tile-id]');
    const overId = tile?.dataset.tileId ?? null;
    if (overId !== this.dragOverId) {
      this.dragOverId = overId;
      this.applyDragVisualState();
    }
  }

  private onPointerUp(): void {
    const from = this.draggingId;
    const to = this.dragOverId;
    this.detachPointerListeners();
    this.isDragging = false;
    this.draggingId = null;
    this.dragOverId = null;
    if (from && to && from !== to) {
      const layout = loadLayout();
      const next = reorderLayout(layout, from, to);
      saveLayout(next);
    }
    this.render();
  }

  private cancelDrag(): void {
    this.detachPointerListeners();
    this.isDragging = false;
    this.draggingId = null;
    this.dragOverId = null;
    this.render();
  }

  private detachPointerListeners(): void {
    if (this.boundPointerMove) window.removeEventListener('mousemove', this.boundPointerMove);
    if (this.boundPointerUp) window.removeEventListener('mouseup', this.boundPointerUp);
    if (this.boundEscape) window.removeEventListener('keydown', this.boundEscape);
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundEscape = null;
  }

  /**
   * Apply transient drag visuals (the dragged tile dims, the hovered
   * tile gets an accent inset) without re-rendering the whole panel —
   * full re-render would interrupt the in-flight drag.
   */
  private applyDragVisualState(): void {
    const tiles = this.content.querySelectorAll<HTMLElement>('[data-tile-id]');
    tiles.forEach((tile) => {
      const id = tile.dataset.tileId ?? '';
      tile.style.opacity = id === this.draggingId ? '0.55' : '';
      tile.style.boxShadow = (id === this.dragOverId && id !== this.draggingId)
        ? '0 0 0 2px var(--accent,#4a9eff) inset'
        : '';
    });
  }

  private onContentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest<HTMLElement>('[data-cc-action="copy-briefing"]')) {
      this._copyBriefing();
      return;
    }
    const guideRow = target.closest<HTMLElement>('[data-cc-open-guide]');
    if (guideRow) {
      const guideId = guideRow.getAttribute('data-cc-open-guide') ?? undefined;
      document.dispatchEvent(new CustomEvent('cb:open-survival-guide', { detail: { guideId } }));
      return;
    }
    if (target.closest<HTMLElement>('[data-action="add-place"]')) {
      document.querySelector<HTMLElement>('[data-panel-id="saved-places"]')?.click();
      return;
    }
    if (target.closest<HTMLElement>('[data-action="reset-layout"]')) {
      this.handleResetLayout();
      return;
    }
    if (target.closest<HTMLElement>('[data-action="ask-submit"]')) {
      const input = this.content.querySelector<HTMLInputElement>('[data-ask-input]');
      this.submitAsk(input?.value ?? this.askDraft);
      return;
    }
    const followUp = target.closest<HTMLElement>('[data-ask-followup]');
    if (followUp) {
      this.submitAsk(followUp.dataset.askFollowup ?? '');
      return;
    }
    const tapeChip = target.closest<HTMLElement>('[data-tape-event-id]');
    if (tapeChip) {
      const id = tapeChip.dataset.tapeEventId ?? '';
      this.expandedTapeEventId = this.expandedTapeEventId === id ? null : id;
      this.render();
    }
  }

  private _copyBriefing(): void {
    if (!this._briefingInput) return;
    try {
      const briefing = buildShareBriefing(this._briefingInput);
      const packet = buildSharePacket({ shareId: 'command-center-briefing', briefing });
      const text = selectFormat(packet, 'markdown');
      void navigator.clipboard?.writeText(text);
    } catch { /* copy is best-effort; never break the panel */ }
  }

  private handleResetLayout(): void {
    clearLayout();
    const fresh = defaultLayout(getSavedPlaces().slice(0, 6));
    saveLayout(fresh);
    this.render();
  }

  // ── Live change tape (deterministic what-changed engine) ────────────────

  private refreshChangeTape(): void {
    recordSnapshot({
      takenAt: Date.now(),
      alerts: this.snapshotAlerts(),
      situations: this.snapshotSituations(),
      feeds: this.snapshotFeeds(),
    });
    this.tapeEvents = getWhatChanged(Date.now() - WHAT_CHANGED_WINDOW_MS);
    if (!this.isDragging) this.render();
  }

  private snapshotAlerts(): AlertState[] {
    return getRecentEvents().map((event) => ({
      id: event.eventId,
      domain: toChangeDomain(event.domain),
      severity: severityFromScore(event.severity),
      summary: event.description,
    }));
  }

  private snapshotSituations(): SituationState[] {
    return getActiveSituations().map((s) => ({
      id: s.id,
      domain: toChangeDomain(s.domain),
      title: s.name,
    }));
  }

  private snapshotFeeds(): FeedState[] {
    const snapshot = getLiveDiagnosticsSnapshot();
    return snapshot.sources.map((src) => ({
      id: src.sourceId,
      status: feedStatusFromHealth(src.status),
      label: src.label ?? src.sourceId,
    }));
  }

  private renderChangeTape(): string {
    if (this.tapeEvents.length === 0) {
      return `<div style="padding:6px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;font-size:11px;color:var(--text-secondary,#aaa);">
        What changed (last hour) · nothing yet — Crystal Ball is gathering baseline.
      </div>`;
    }
    const chips = this.tapeEvents.map((event) => {
      const expanded = this.expandedTapeEventId === event.id;
      const ringBg = expanded ? 'rgba(74,158,255,0.16)' : 'rgba(255,255,255,0.04)';
      return `<button type="button" data-tape-event-id="${escapeHtml(event.id)}"
        style="flex:0 0 auto;padding:4px 10px;border:1px solid var(--border-subtle,#444);border-radius:999px;background:${ringBg};color:inherit;font-size:11px;white-space:nowrap;cursor:pointer;">
        ${escapeHtml(formatDelta(event))}
        <span style="color:var(--text-secondary,#aaa);margin-left:6px;">${escapeHtml(formatAge(event.timestamp))}</span>
      </button>`;
    }).join('');
    const detail = this.renderExpandedTapeDetail();
    return `<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;">What changed (last hour)</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);">${this.tapeEvents.length} ${this.tapeEvents.length === 1 ? 'event' : 'events'}</div>
      </div>
      <div style="overflow-x:auto;display:flex;gap:6px;padding-bottom:4px;">${chips}</div>
      ${detail}
    </div>`;
  }

  private renderExpandedTapeDetail(): string {
    if (!this.expandedTapeEventId) return '';
    const event = this.tapeEvents.find((e) => e.id === this.expandedTapeEventId);
    if (!event) return '';
    const time = new Date(event.timestamp).toLocaleString();
    return `<div style="margin-top:6px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid var(--accent,#4a9eff);border-radius:4px;background:rgba(74,158,255,0.06);">
      <div style="font-size:11px;font-weight:700;">${escapeHtml(formatDelta(event))}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(event.domain.toUpperCase())} · ${escapeHtml(event.type)} · ${escapeHtml(time)}</div>
    </div>`;
  }
}

function criticalRank(f: FeatureHealth): number {
  const sev: Record<HealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    stale: 3,
    blind: 4,
    failing: 5,
    unsafe: 6,
  };
  return sev[f.status] + (f.critical ? 10 : 0);
}

// ── Five-question spine helpers ──────────────────────────────────────────

function spineSection(title: string, bodyHtml: string): string {
  return `<div style="display:flex;flex-direction:column;gap:4px;">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;">${escapeHtml(title)}</div>
    ${bodyHtml}
  </div>`;
}

function severityBackground(sev: 'critical' | 'high' | 'moderate' | 'low' | 'info'): string {
  switch (sev) {
    case 'critical': { return 'rgba(220,38,38,0.72)';
    }
    case 'high': { return 'rgba(248,113,113,0.72)';
    }
    case 'moderate': { return 'rgba(251,146,60,0.72)';
    }
    case 'low': { return 'rgba(250,204,21,0.72)';
    }
    case 'info': { return 'rgba(34,197,94,0.72)';
    }
  }
}

function polarityIcon(p: 'up' | 'down' | 'flat'): string {
  if (p === 'up') return '↑';
  if (p === 'down') return '↓';
  return '→';
}

function freshnessColor(f: 'FRESH' | 'STALE' | 'DEGRADED'): string {
  if (f === 'FRESH') return '#22c55e';
  if (f === 'STALE') return '#facc15';
  return '#f87171';
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

// ── what-changed adapters ────────────────────────────────────────────────

const KNOWN_DOMAINS: readonly ChangeDomain[] = [
  'weather', 'cyber', 'finance', 'conflict', 'seismic', 'energy', 'system', 'other',
];

function toChangeDomain(raw: string): ChangeDomain {
  const lower = raw.toLowerCase();
  for (const d of KNOWN_DOMAINS) {
    if (lower === d) return d;
  }
  if (lower === 'market' || lower === 'crypto') return 'finance';
  if (lower === 'earthquake' || lower === 'natural') return 'seismic';
  if (lower === 'war' || lower === 'geopolitics') return 'conflict';
  return 'other';
}

function severityFromScore(score: number): AlertSeverityLike {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  if (score >= 20) return 'LOW';
  return 'INFO';
}

function feedStatusFromHealth(status: HealthStatus): FeedHealthLike {
  if (status === 'healthy') return 'healthy';
  if (status === 'failing' || status === 'unsafe' || status === 'blind') return 'down';
  return 'degraded';
}

function formatAge(epoch: number): string {
  const min = Math.floor(Math.max(0, Date.now() - epoch) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
