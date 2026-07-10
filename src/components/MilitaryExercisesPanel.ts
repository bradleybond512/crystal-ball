/**
 * MilitaryExercisesPanel (panel id: `military-exercises`).
 *
 * Tracks major military exercises as geopolitical signals. Scale, location,
 * and timing of exercises reveal strategic intent and readiness.
 *
 * Pure logic lives in `military-exercises-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  type MilitaryExercise,
  threatLevelColor,
  threatLevelLabel,
  signalTypeLabel,
  signalTypeColor,
  exerciseTypeColor,
  formatTroops,
  getLargeExercises,
  getCoerciveExercises,
  getCriticalAndHigh,
  computeRegionalIntensity,
  buildRenderData,
  EXERCISES,
} from './military-exercises-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24-hour refresh

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class MilitaryExercisesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id:           'military-exercises',
      title:        'Military Exercises Monitor',
      showCount:    true,
      trackActivity:true,
      infoTooltip:
        'Tracks major military exercises as geopolitical signals. Scale, location, and timing reveal strategic intent: deterrence postures, coercive pressure, alliance health, and warfighting readiness.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const liveEvents = safe(() => query({ domain: 'security', tag: 'military-exercises', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    const critCount   = getCriticalAndHigh(EXERCISES).length;
    const coercCount  = getCoerciveExercises(EXERCISES).length;
    this.setCount(critCount + coercCount + liveHighCount);

    const rd = buildRenderData(EXERCISES);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildIntensitySection(rd.intensities),
        this.buildLargeSection(rd.large),
        this.buildPacificSection(rd.pacificExercises),
        this.buildEuropeSection(rd.europeExercises),
        this.buildOtherSection(rd.otherExercises),
      ),
    );
  }

  // ── Section 1: Regional Intensity Index ────────────────────────────────────
  private buildIntensitySection(intensities: ReturnType<typeof computeRegionalIntensity>): HTMLElement {
    const tbody  = h('tbody');
    const active = intensities
      .filter((r) => r.exerciseCount > 0)
      .sort((a, b) => b.intensityScore - a.intensityScore);

    for (const r of active) {
      const tColor = threatLevelColor(r.level);
      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` }, r.region),
          cell(`${r.exerciseCount} exercises`, 'color:#9e9e9e'),
          cell(`${formatTroops(r.totalTroops)} troops`, 'color:#facc15;text-align:right'),
          cell(`${r.largeExerciseCount} large`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            `${r.intensityScore}/100`),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Regional Exercise Intensity Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · exercises · troops · large (≥10k) · composite intensity score',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Major Exercises (≥10k troops) ───────────────────────────────
  private buildLargeSection(exercises: ReturnType<typeof getLargeExercises>): HTMLElement {
    const badge = exercises.length > 0 ? countBadge(exercises.length, 'major') : undefined;
    return h('div', { className: 'app-section' },
      sectionHeader('Major Exercises (≥10,000 troops)', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Exercise · date · type · troops · signal · threat level',
      ),
      this.buildExerciseTable(exercises),
    );
  }

  // ── Section 3: Pacific Theatre ─────────────────────────────────────────────
  private buildPacificSection(exercises: MilitaryExercise[]): HTMLElement {
    const coercive = getCoerciveExercises(exercises).length;
    const badge    = coercive > 0 ? countBadge(coercive, 'coercive') : undefined;
    return h('div', { className: 'app-section' },
      sectionHeader('Pacific Theatre Exercises', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Exercise · date · type · troops · signal · threat level',
      ),
      this.buildExerciseTable(exercises),
    );
  }

  // ── Section 4: European Theatre ───────────────────────────────────────────
  private buildEuropeSection(exercises: MilitaryExercise[]): HTMLElement {
    return h('div', { className: 'app-section' },
      sectionHeader('European Theatre Exercises'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Exercise · date · type · troops · signal · threat level',
      ),
      this.buildExerciseTable(exercises),
    );
  }

  // ── Section 5: Other Regions ───────────────────────────────────────────────
  private buildOtherSection(exercises: MilitaryExercise[]): HTMLElement {
    return h('div', { className: 'app-section' },
      sectionHeader('Other Regional Exercises'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Exercise · date · region · troops · signal · threat level',
      ),
      this.buildExerciseTable(exercises),
    );
  }

  private buildExerciseTable(exercises: MilitaryExercise[]): HTMLElement {
    if (exercises.length === 0) {
      return h('div', { style: 'color:#9e9e9e;font-size:12px;padding:8px' }, 'No exercises in this category.');
    }
    const tbody = h('tbody');
    for (const e of exercises) {
      const tColor    = threatLevelColor(e.threatLevel);
      const sColor    = signalTypeColor(e.signalType);
      const typeColor = exerciseTypeColor(e.type);
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, e.name),
          cell(e.date, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${typeColor}` }, e.type),
          cell(formatTroops(e.troops), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor}` },
            signalTypeLabel(e.signalType)),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            threatLevelLabel(e.threatLevel)),
        ),
      );
    }
    return h('table', { style: 'width:100%;border-collapse:collapse' }, tbody);
  }
}
