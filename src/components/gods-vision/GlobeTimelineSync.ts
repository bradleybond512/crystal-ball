/**
 * GlobeTimelineSync
 * ----------------
 * Bridge between the existing GlobeTimeMachine (cursor controller) and
 * the timeline-cursor visibility helper from PR #332. Subscribes to
 * the time-machine's onTimeChange callback, computes which TimelineEvents
 * are "visible at the cursor" via `visibleAt()`, and broadcasts the
 * result to the rest of the app via a custom DOM event.
 *
 * Also renders a tiny "N events @ cursor" badge near the time-machine
 * bar so users get immediate visual feedback that the cursor is doing
 * something. Anything else that wants to fade/dim entities can listen
 * for `wm:globe-timeline-cursor` and react.
 *
 * The deeper integration (entity opacity changes inside GlobeDataManager)
 * is intentionally NOT in this component — that's a per-layer concern
 * and lands in a follow-up after each layer manager picks the visibility
 * model that suits it.
 */

import type { GlobeTimeMachine } from '@/components/GlobeTimeMachine';
import { getEventsInWindow } from '@/services/timeline-scrubber';
import {
  countByType,
  visibleAt,
  type VisibleTimelineEvent,
} from '@/services/playback/timeline-cursor';

/** Event detail dispatched on `document` whenever the cursor changes
 *  and the visible-event set is recomputed. */
export interface GlobeTimelineCursorEvent extends CustomEvent {
  detail: {
    /** ms epoch of the time-machine cursor. */
    cursorMs: number;
    visible: VisibleTimelineEvent[];
    countsByType: ReturnType<typeof countByType>;
  };
}

const CURSOR_EVENT = 'wm:globe-timeline-cursor';
/** How far back to look for events around the cursor. Matches
 *  timeline-cursor's default window (6 h). */
const CURSOR_WINDOW_MS = 6 * 60 * 60 * 1000;

export class GlobeTimelineSync {
  private timeMachine: GlobeTimeMachine;
  private container: HTMLElement;
  private badge: HTMLDivElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(timeMachine: GlobeTimeMachine, container: HTMLElement) {
    this.timeMachine = timeMachine;
    this.container = container;
  }

  mount(): void {
    const badge = document.createElement('div');
    badge.className = 'globe-timeline-sync-badge';
    badge.style.cssText = [
      'position:absolute',
      'bottom:46px',
      'left:50%',
      'transform:translateX(-50%)',
      'padding:4px 8px',
      'border-radius:10px',
      'background:rgba(0,0,0,0.55)',
      'color:#fff',
      'font:11px/1.2 ui-monospace,Menlo,monospace',
      'pointer-events:none',
      'z-index:8',
      'opacity:0',
      'transition:opacity 0.2s',
    ].join(';');
    this.container.append(badge);
    this.badge = badge;

    // Initial paint at "now" so we don't sit at "0 events" on mount.
    this.handleTimeChange(Date.now());

    this.unsubscribe = this.timeMachine.onTimeChange((ms) => this.handleTimeChange(ms));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.badge?.remove();
    this.badge = null;
  }

  private handleTimeChange(cursorMs: number): void {
    // Pull the lookback window of timeline events ending at the cursor.
    const startMs = cursorMs - CURSOR_WINDOW_MS;
    const allEvents = getEventsInWindow(startMs, cursorMs);
    const visible = visibleAt(allEvents, { currentMs: cursorMs, windowMs: CURSOR_WINDOW_MS });
    const counts = countByType(visible);

    // Update the inline badge — only show when ≥1 event is visible.
    if (this.badge) {
      if (visible.length > 0) {
        this.badge.textContent = `${visible.length} event${visible.length === 1 ? '' : 's'} @ cursor`;
        this.badge.style.opacity = '1';
      } else {
        this.badge.style.opacity = '0';
      }
    }

    // Broadcast for any layer manager that wants to react.
    document.dispatchEvent(new CustomEvent(CURSOR_EVENT, {
      detail: { cursorMs, visible, countsByType: counts },
    }));
  }
}

export const GLOBE_TIMELINE_CURSOR_EVENT = CURSOR_EVENT;
