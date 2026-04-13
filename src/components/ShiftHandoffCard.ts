/* eslint-disable sonarjs/void-use */
/**
 * ShiftHandoffCard — one-click "Last 8 hours" summary card.
 * Overlay that shows top stories, active situations, forecast accuracy,
 * and degraded sources.
 *
 * Triggered by `cb:shift-handoff` event or ⌘⇧H keyboard shortcut.
 */

import { generateShiftBriefing, type ShiftBriefing } from '@/services/shift-handoff';

export class ShiftHandoffCard {
  private overlay: HTMLElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'shift-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.hide(); });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.overlay);
    document.addEventListener('cb:shift-handoff', () => this.show());
  }

  show(): void {
    const briefing = generateShiftBriefing(8);
    this.overlay.hidden = false;
    this.overlay.textContent = '';
    this.overlay.append(this.buildCard(briefing));
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  private buildCard(b: ShiftBriefing): HTMLElement {
    const card = document.createElement('div');
    card.className = 'shift-card';

    // Header
    const header = document.createElement('div');
    header.className = 'shift-header';
    const title = document.createElement('h2');
    title.textContent = `Shift Briefing — Last ${b.periodHours}h`;
    const time = document.createElement('span');
    time.className = 'shift-time';
    time.textContent = new Date(b.generatedAt).toLocaleString();
    const close = document.createElement('button');
    close.className = 'shift-close';
    close.textContent = '\u2715';
    close.addEventListener('click', () => this.hide());
    header.append(title, time, close);
    card.append(header);

    // Stats row
    const stats = document.createElement('div');
    stats.className = 'shift-stats';
    stats.append(
      this.statPill('Total', String(b.totalAlerts)),
      this.statPill('Acked', String(b.acknowledgedCount)),
      this.statPill('Rising', String(b.lifecycleSummary.rising)),
      this.statPill('Peaked', String(b.lifecycleSummary.peaked)),
      this.statPill('Cooling', String(b.lifecycleSummary.cooling)),
      this.statPill('Resolved', String(b.resolvedStories)),
    );
    card.append(stats);

    // Top stories
    if (b.topStories.length > 0) {
      const sec = document.createElement('section');
      sec.className = 'shift-section';
      const h = document.createElement('h3'); h.textContent = 'Top Stories';
      sec.append(h);
      for (const s of b.topStories) {
        const row = document.createElement('div'); row.className = 'shift-story-row';
        const sev = document.createElement('span');
        sev.className = `shift-sev shift-sev-${s.leadSeverity}`;
        sev.textContent = s.leadSeverity.slice(0, 4).toUpperCase();
        const label = document.createElement('span'); label.textContent = `${s.label} (${s.count})`;
        row.append(sev, label);
        sec.append(row);
      }
      card.append(sec);
    }

    // Active situations
    if (b.activeSituations.length > 0) {
      const sec = document.createElement('section');
      sec.className = 'shift-section';
      const h = document.createElement('h3'); h.textContent = 'Active Situations';
      sec.append(h);
      for (const s of b.activeSituations) {
        const row = document.createElement('div'); row.className = 'shift-sit-row';
        row.textContent = `${s.title} — ${s.phase} (${Math.round(s.confidence * 100)}%)`;
        sec.append(row);
      }
      card.append(sec);
    }

    // Forecast accuracy
    const accSec = document.createElement('section');
    accSec.className = 'shift-section';
    const accH = document.createElement('h3'); accH.textContent = 'Forecast Accuracy';
    const accP = document.createElement('p');
    accP.textContent = b.forecastAccuracy.totalPredictions > 0
      ? `${b.forecastAccuracy.accuracy}% (${b.forecastAccuracy.hits} hits, ${b.forecastAccuracy.misses} misses, ${b.forecastAccuracy.pending} pending)`
      : 'No predictions logged yet';
    accSec.append(accH, accP);
    card.append(accSec);

    // Degraded sources
    if (b.degradedSources.length > 0) {
      const sec = document.createElement('section');
      sec.className = 'shift-section shift-section-warn';
      const h = document.createElement('h3'); h.textContent = 'Degraded Sources';
      sec.append(h);
      for (const s of b.degradedSources) {
        const row = document.createElement('div'); row.className = 'shift-degraded-row';
        row.textContent = `${s.name}: ${s.status} (${Math.round(s.errorRate * 100)}% errors)`;
        sec.append(row);
      }
      card.append(sec);
    }

    return card;
  }

  private statPill(label: string, value: string): HTMLElement {
    const pill = document.createElement('div');
    pill.className = 'shift-stat-pill';
    const v = document.createElement('span'); v.className = 'shift-stat-val'; v.textContent = value;
    const l = document.createElement('span'); l.className = 'shift-stat-label'; l.textContent = label;
    pill.append(v, l);
    return pill;
  }
}
