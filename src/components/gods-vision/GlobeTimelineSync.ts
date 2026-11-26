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
    if (this.badge) return;
    const badge = document.createElement('div');
    badge.className = 'globe-timeline-sync-badge';
    badge.style.cssText = 'flex:1 0 100%;font-size:11px;line-height:1.4';
    badge.title = 'In-memory timeline events within six hours of the selected time. Zero retained events does not mean no events occurred.';
    this.container.append(badge);
    this.badge = badge;

    this.handleTimeChange(this.timeMachine.getCurrentMs());

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

    if (this.badge) {
      this.badge.textContent = `${visible.length} retained timeline event${visible.length === 1 ? '' : 's'}`;
    }

    // Broadcast for any layer manager that wants to react.
    document.dispatchEvent(new CustomEvent(CURSOR_EVENT, {
      detail: { cursorMs, visible, countsByType: counts },
    }));
  }
}

export const GLOBE_TIMELINE_CURSOR_EVENT = CURSOR_EVENT;
