/**
 * Timeline Scrubber Panel
 *
 * Displays temporal distribution of monitored events with severity breakdown.
 * Shows event count, time range, recent events, and a histogram.
 */

import { Panel } from './Panel';
import {
  getTimelineRange,
  getEventsInWindow,
  getTimelineBuckets,
  getEventCount,
  type TimelineEvent,
  type TimelineEventSeverity,
} from '@/services/timeline-scrubber';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const SEV_COLORS: Record<TimelineEventSeverity, string> = {
  low: '#4caf50',
  medium: '#ffc107',
  high: '#ff9800',
  critical: '#f44336',
};

const SEV_ORDER: TimelineEventSeverity[] = ['critical', 'high', 'medium', 'low'];

export class TimelineScrubberPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'timeline-scrubber',
 title: 'Timeline Scrubber',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Temporal event store for playback and analysis. Shows event distribution over time with severity breakdown.',
 });
 this.showLoading('Loading timeline\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 45_000);
  }

  private render(): void {
 const totalCount = getEventCount();
 const range = getTimelineRange();

 this.setCount(totalCount);

 if (totalCount === 0) {
 this.setContent('<div class="panel-empty">No timeline events recorded yet. Events will appear as data flows in.</div>');
 return;
 }

 const now = Date.now();
 const twoHoursAgo = now - 2 * 60 * 60 * 1000;
 const recentEvents = getEventsInWindow(twoHoursAgo, now);
 const buckets = getTimelineBuckets(15 * 60 * 1000, twoHoursAgo, now);

 // Severity distribution
 const sevCounts: Record<TimelineEventSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
 for (const e of recentEvents) {
 sevCounts[e.severity] = (sevCounts[e.severity] ?? 0) + 1;
 }

 const rangeStr = range.earliest > 0 ? `${formatTime(new Date(range.earliest))} \u2192 ${formatTime(new Date(range.latest))}` : 'N/A';

 const statsHtml = `<div style="padding:8px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <div style="display:flex;gap:12px;">
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${totalCount}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Total</span></div>
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${recentEvents.length}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">2h</span></div>
 </div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:4px;text-align:center;">${escapeHtml(rangeStr)}</div>
 </div>`;

 const sevHtml = `<div style="display:flex;gap:8px;margin-top:8px;">
 ${SEV_ORDER.map(s => `<div style="text-align:center;flex:1;">
 <span style="font-size:14px;font-weight:700;color:${SEV_COLORS[s]};">${sevCounts[s]}</span>
 <br><span style="font-size:9px;color:var(--text-muted,#888);">${s}</span>
 </div>`).join('')}
 </div>`;

 // Histogram
 const maxBucket = Math.max(1, ...buckets.map(b => b.count));
 const histHtml = buckets.length > 0 ? `<div style="margin-top:10px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Last 2 Hours</div>
 <div style="display:flex;align-items:flex-end;gap:1px;height:40px;">
 ${buckets.map(b => {
 const pct = Math.round((b.count / maxBucket) * 100);
 const barColor = b.bySeverity.critical > 0 ? SEV_COLORS.critical : b.bySeverity.high > 0 ? SEV_COLORS.high : b.bySeverity.medium > 0 ? SEV_COLORS.medium : SEV_COLORS.low;
 return `<div style="flex:1;height:${pct}%;background:${barColor};border-radius:2px 2px 0 0;min-height:${b.count > 0 ? 2 : 0}px;" title="${b.count} events"></div>`;
 }).join('')}
 </div>
 </div>` : '';

 // Recent events list
 const recentHtml = recentEvents.length > 0 ? `<div style="margin-top:10px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Recent Events</div>
 ${recentEvents.slice(0, 10).map((e: TimelineEvent) => {
 const sevColor = SEV_COLORS[e.severity] ?? '#999';
 return `<div style="border-left:3px solid ${sevColor};padding:3px 8px;margin-bottom:3px;border-radius:0 4px 4px 0;">
 <div style="font-size:11px;font-weight:600;">${escapeHtml(e.title)}</div>
 <div style="font-size:9px;color:var(--text-muted,#888);">${escapeHtml(e.type)} \u2022 ${escapeHtml(e.source)} \u2022 ${formatTime(new Date(e.timestamp))}</div>
 </div>`;
 }).join('')}
 </div>` : '';

 this.setContent(`<div style="padding:8px 12px;">${statsHtml}${sevHtml}${histHtml}${recentHtml}</div>`);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
