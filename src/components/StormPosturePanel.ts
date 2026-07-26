/**
 * Storm Posture Panel — renders the survival engine's "Storm Posture" for the
 * user's saved places.
 *
 * Render-only over `getStormSnapshot()`. The state singleton
 * (`storm-posture-state.ts`) owns all fetching; this panel never fetches.
 * On construction it hydrates the last saved snapshot from IDB, kicks off a
 * live refresh, and re-renders whenever the singleton notifies. A 120-second
 * interval keeps the posture fresh on its own even if the data-loader weather
 * tick is idle.
 *
 * Layout (top → bottom):
 *   1. Grid-down banner when the underlying weather feed is stale.
 *   2. Overall posture card (band label + headline), tinted by band.
 *   3. One card per active posture axis (physical safety, supply, …).
 *   4. Recommended moves with a Commit button (or "planned" status).
 */

import { Panel } from './Panel.ts';
import {
  getStormSnapshot,
  subscribeStormPosture,
  hydrateStormPosture,
  refreshStormPosture,
  commitStormMove,
} from '@/services/survival/storm-posture-state.ts';
import { projectView } from '@/services/survival/world-snapshot.ts';
import { availableMoves } from '@/services/survival/survival-moves.ts';
import type {
  AxisState,
  PostureThreat,
  SurvivalBand,
  SurvivalMove,
  SurvivalPosture,
  WorldSnapshot,
} from '@/services/survival/survival-types.ts';
import { axisLabel, SURVIVAL_AXES, type SurvivalAxis } from '@/services/survival/survival-types.ts';
import { survivalMapModes } from '@/services/survival/survival-map-modes.ts';
import { selectPostureCards } from './storm-posture-view.ts';
import { escapeHtml } from '@/utils/sanitize.ts';

const REFRESH_MS = 120_000;

// ── Band palette ───────────────────────────────────────────────────────────

const BAND_COLOR: Record<SurvivalBand, string> = {
  secure: 'var(--sev-low,#34c759)',
  guarded: 'var(--status-guarded,#a7c957)',
  elevated: 'var(--sev-medium,#ffd60a)',
  high: '#ff9f0a',
  critical: '#ff453a',
};

function bandColor(band: SurvivalBand): string {
  return BAND_COLOR[band];
}

// ── Panel class ───────────────────────────────────────────────────────────

export class StormPosturePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribe: () => void;

  constructor() {
    super({
      id: 'storm-posture',
      title: 'Storm Posture',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Your survival posture across weather, supply, and other domains near your saved places.',
    });

    this.unsubscribe = subscribeStormPosture(() => this.render());
    document.addEventListener('click', this.onCommitClick);
    document.addEventListener('click', this.onModeClick);
    this.start();
  }

  private start(): void {
    void hydrateStormPosture().then(() => this.render());
    void refreshStormPosture();
    this.refreshTimer = setInterval(() => void refreshStormPosture(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    document.removeEventListener('click', this.onCommitClick);
    document.removeEventListener('click', this.onModeClick);
    this.unsubscribe();
    super.destroy();
  }

  private render(): void {
    const snap = getStormSnapshot();
    if (!snap) {
      this.showLoading('Reading your survival posture…');
      return;
    }

    const now = Date.now();
    const view = projectView(snap, { now });
    const moves = availableMoves(snap.posture, snap, { now });
    this.setCount(snap.posture.axes.reduce((n, a) => n + a.threats.length, 0));
    this.setContent(this.buildHtml(snap, view.posture, moves, view.isStale, view.weatherAgeMs));
    this.markFresh();
  }

  private buildHtml(
    snap: WorldSnapshot,
    posture: SurvivalPosture,
    moves: readonly SurvivalMove[],
    isStale: boolean,
    weatherAgeMs: number,
  ): string {
    const banner = isStale ? this.buildStaleBanner(weatherAgeMs) : '';
    const modeChips = this.buildMapModeChips();
    const overall = this.buildOverallCard(posture);
    const cards = selectPostureCards(posture).map((a) => this.buildAxisCard(a)).join('');
    const movesCard = this.buildMovesCard(snap, moves);
    return `${banner}${modeChips}${overall}${cards}${movesCard}`;
  }

  private buildStaleBanner(weatherAgeMs: number): string {
    const mins = Math.round(weatherAgeMs / 60_000);
    return `<div style="padding:6px 12px;background:rgba(255,159,10,0.12);border-bottom:1px solid rgba(255,159,10,0.3);font-size:11px;font-weight:600;color:#ff9f0a;letter-spacing:0.03em;">
      ⚠ Data is ${mins} min old — showing last known posture
    </div>`;
  }

  private buildOverallCard(posture: SurvivalPosture): string {
    const color = bandColor(posture.overallBand);
    return `<div style="margin:10px;padding:12px 14px;border-left:3px solid ${color};border-radius:4px;background:${color}1a;">
      <div style="font-size:18px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(posture.overallBand)}</div>
      <div style="margin-top:4px;font-size:13px;color:var(--text-primary,#ddd);">${escapeHtml(posture.headline)}</div>
    </div>`;
  }

  private buildAxisCard(axis: AxisState): string {
    const color = bandColor(axis.band);
    const header = `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">
      <span style="font-size:13px;font-weight:600;color:var(--text-primary,#ddd);">${escapeHtml(axisLabel(axis.axis))}</span>
      <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(axis.band)} · ${Math.round(axis.level)}</span>
    </div>`;

    const emptyCopy = axis.axis === 'physical_safety'
      ? 'Secure — no active severe-weather threats near your saved places.'
      : 'Secure — no active threats.';
    const body = axis.threats.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#888);">${emptyCopy}</div>`
      : axis.threats.map((t) => this.buildThreatRow(t)).join('');

    return `<div style="margin:0 10px 10px;padding:10px 12px;border:1px solid var(--border-subtle,#2a2a2a);border-radius:6px;background:var(--bg-elevated,rgba(255,255,255,0.02));">
      ${header}${body}
    </div>`;
  }

  private buildThreatRow(threat: PostureThreat): string {
    const arrival = threat.arrivalLabel ?? 'arrival window unknown';
    return `<div style="padding:7px 0;border-top:1px solid var(--border-subtle,#222);">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
        <span style="font-size:12px;font-weight:600;color:var(--text-primary,#ddd);">${escapeHtml(threat.hazardLabel)}</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-secondary,#999);text-transform:uppercase;letter-spacing:0.05em;padding:1px 5px;border:1px solid var(--border-subtle,#444);border-radius:2px;white-space:nowrap;">${escapeHtml(threat.confidenceLabel)}</span>
      </div>
      <div style="margin-top:2px;font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(threat.why)}</div>
      <div style="margin-top:2px;font-size:11px;color:var(--text-secondary,#888);">${escapeHtml(arrival)}</div>
    </div>`;
  }

  private buildMovesCard(snap: WorldSnapshot, moves: readonly SurvivalMove[]): string {
    if (moves.length === 0) return '';
    const rows = moves.map((m) => this.buildMoveRow(snap, m)).join('');
    return `<div style="margin:0 10px 12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin:0 2px 6px;">Recommended moves</div>
      ${rows}
    </div>`;
  }

  private buildMoveRow(snap: WorldSnapshot, move: SurvivalMove): string {
    const committed = snap.plan.committed.find((c) => c.moveId === move.id);
    const effectText = this.formatEffect(move);
    const action = committed
      ? `<span style="font-size:11px;font-weight:600;color:#34c759;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">${escapeHtml(committed.status)}</span>`
      : `<button data-storm-move="${escapeHtml(move.id)}" style="font-size:11px;font-weight:600;padding:3px 10px;border:1px solid var(--accent,#0a84ff);border-radius:4px;background:transparent;color:var(--accent,#0a84ff);cursor:pointer;white-space:nowrap;">Commit</button>`;

    return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--border-subtle,#2a2a2a);border-radius:6px;background:var(--bg-elevated,rgba(255,255,255,0.02));">
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary,#ddd);">${escapeHtml(move.label)}</div>
        <div style="margin-top:2px;font-size:11px;color:var(--text-secondary,#999);display:flex;gap:8px;flex-wrap:wrap;">
          <span>${escapeHtml(move.cost)}</span>
          <span>~${move.leadTimeMins}min</span>
          <span style="color:#34c759;">${escapeHtml(effectText)}</span>
        </div>
      </div>
      ${action}
    </div>`;
  }

  private formatEffect(move: SurvivalMove): string {
    const first = move.effect[0];
    if (!first) return 'no modeled effect';
    const sign = first.deltaLevel < 0 ? '−' : '+';
    const axisLabel = first.axis.replace(/_/g, ' ');
    return `${sign}${Math.abs(first.deltaLevel)} ${axisLabel}`;
  }

  private readonly onCommitClick = (ev: Event): void => {
    const btn = (ev.target as Element | null)?.closest('[data-storm-move]');
    if (!btn) return;
    const moveId = btn.getAttribute('data-storm-move');
    if (!moveId) return;
    const snap = getStormSnapshot();
    if (!snap) return;
    const moves = availableMoves(snap.posture, snap, { now: Date.now() });
    const move = moves.find((m) => m.id === moveId);
    if (!move) return;
    commitStormMove(move);
  };

  /** Map-mode chips: focus the map on one survival axis' layers (E4 glue). */
  private buildMapModeChips(): string {
    const modes = survivalMapModes();
    const active = new Set(modes?.active());
    const chipBase = 'font-size:11px;padding:3px 9px;border-radius:12px;cursor:pointer;border:1px solid #444;';
    const chips = SURVIVAL_AXES.map((axis) => {
      const on = active.has(axis);
      const style = `${chipBase}background:${on ? '#1f6feb' : 'transparent'};color:${on ? '#fff' : 'inherit'};`;
      return `<button type="button" data-map-mode="${axis}" aria-pressed="${on}" style="${style}">`
        + `${escapeHtml(axisLabel(axis))}</button>`;
    }).join('');
    const clear = active.size > 0
      ? `<button type="button" data-map-mode="__clear" style="${chipBase}background:transparent;color:inherit;opacity:0.75;">Clear</button>`
      : '';
    return `<div role="group" aria-label="Focus map on a survival axis" `
      + `style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 4px;">`
      + `<span style="font-size:11px;opacity:0.6;">Map focus</span>${chips}${clear}</div>`;
  }

  private readonly onModeClick = (ev: Event): void => {
    const btn = (ev.target as Element | null)?.closest('[data-map-mode]');
    if (!btn || !this.getContentElement().contains(btn)) return;
    const modes = survivalMapModes();
    if (!modes) return; // map not mounted yet — no-op
    const axis = btn.getAttribute('data-map-mode');
    if (axis === '__clear') modes.clear();
    else if (axis) modes.toggle(axis as SurvivalAxis);
    this.render();
  };
}
