/**
 * StoryTimeline — expandable mini-timeline showing when each alert
 * in a story arrived, with lifecycle phase markers.
 *
 * Used inline in UnifiedAlertInboxPanel when a grouped story row is expanded.
 * Also provides a DOM builder for standalone use.
 */

import type { UnifiedAlert } from '@/services/unified-alerts';
import { getLifecyclePhase, type LifecyclePhase } from '@/services/alert-lifecycle';

const PHASE_COLOR: Record<LifecyclePhase, string> = {
  rising: '#ff453a',
  peaked: '#ff8800',
  cooling: '#88cc44',
  resolved: '#666',
};

const PHASE_ICON: Record<LifecyclePhase, string> = {
  rising: '\u2191',
  peaked: '\u25CF',
  cooling: '\u2193',
  resolved: '\u25CB',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Build timeline HTML string for embedding in innerHTML-based panels. */
export function buildStoryTimelineHtml(alerts: UnifiedAlert[]): string {
  if (alerts.length < 2) return '';

  const sorted = [...alerts].sort((a, b) => a.timestamp - b.timestamp);
  const earliest = sorted[0]!.timestamp;
  const latest = sorted[sorted.length - 1]!.timestamp;
  const span = Math.max(latest - earliest, 60_000);

  let markers = '';
  for (const a of sorted) {
    const pct = ((a.timestamp - earliest) / span) * 100;
    const phase = getLifecyclePhase(a.id);
    const ageMin = Math.max(0, Math.round((Date.now() - a.timestamp) / 60_000));
    const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
    markers += `<div class="story-tl-marker story-tl-sev-${a.severity}" style="left:${pct.toFixed(1)}%;border-color:${PHASE_COLOR[phase]}" title="${esc(a.source)}: ${esc(a.title)}\n${PHASE_ICON[phase]} ${phase} · ${ageLabel}"></div>`;
  }

  return `<div class="story-timeline">
    <span class="story-tl-axis">${esc(formatTimeShort(earliest))}</span>
    <div class="story-tl-track">${markers}</div>
    <span class="story-tl-axis story-tl-axis-right">${esc(formatTimeShort(latest))}</span>
  </div>`;
}

/** Build timeline as a DOM element for standalone use. */
export function buildStoryTimeline(alerts: UnifiedAlert[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'story-timeline';

  if (alerts.length < 2) return container;

  const sorted = [...alerts].sort((a, b) => a.timestamp - b.timestamp);
  const earliest = sorted[0]!.timestamp;
  const latest = sorted[sorted.length - 1]!.timestamp;
  const span = Math.max(latest - earliest, 60_000);

  const track = document.createElement('div');
  track.className = 'story-tl-track';

  for (const a of sorted) {
    const pct = ((a.timestamp - earliest) / span) * 100;
    const phase = getLifecyclePhase(a.id);
    const marker = document.createElement('div');
    marker.className = `story-tl-marker story-tl-sev-${a.severity}`;
    marker.style.left = `${pct}%`;
    marker.style.borderColor = PHASE_COLOR[phase];

    const ageMin = Math.max(0, Math.round((Date.now() - a.timestamp) / 60_000));
    const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
    marker.title = `${a.source}: ${a.title}\n${PHASE_ICON[phase]} ${phase} · ${ageLabel}`;
    track.append(marker);
  }

  const axisLeft = document.createElement('span');
  axisLeft.className = 'story-tl-axis';
  axisLeft.textContent = formatTimeShort(earliest);

  const axisRight = document.createElement('span');
  axisRight.className = 'story-tl-axis story-tl-axis-right';
  axisRight.textContent = formatTimeShort(latest);

  container.append(axisLeft, track, axisRight);
  return container;
}
