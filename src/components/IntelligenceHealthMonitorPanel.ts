/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Intelligence Health Monitor Panel — operator's "is the system
 * working?" view. Large gauge for the overall score, six component
 * rows (status dot + score bar + detail text), a Run Check button,
 * the last-checked timestamp, and a sparkline of the last 10 snapshots.
 */

import { Panel } from './Panel';
import {
  getIntelligenceHealthMonitorService,
  type ComponentHealth,
  type ComponentStatus,
  type SystemHealthSnapshot,
  type SystemStatus,
} from '@/services/intelligence/intelligence-health-monitor';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const SPARKLINE_LIMIT = 10;

const STATUS_COLOR: Record<SystemStatus, string> = {
  ok: '#4caf50',
  degraded: '#ffb74d',
  error: '#ff453a',
};

const COMPONENT_STATUS_COLOR: Record<ComponentStatus, string> = {
  ok: '#4caf50',
  degraded: '#ffb74d',
  error: '#ff453a',
  unknown: '#9e9e9e',
};

export class IntelligenceHealthMonitorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'intelligence-health-monitor',
      title: 'Intelligence Health Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Top-level health dashboard. Polls Situation Store, Civilization Pulse, Feed Watchdog, Safety Case, Trust Budget, and Improvement Scheduler. Overall score = mean of component scores. ≥0.8 ok, ≥0.5 degraded, <0.5 error.',
    });
    this.start();
  }

  private start(): void {
    // Run a check on mount so the panel never opens empty.
    try {
      getIntelligenceHealthMonitorService().check();
    } catch {
      /* probes are individually try/caught — defensive */
    }
    this.render();
    this.refreshTimer = setInterval(() => {
      try {
        getIntelligenceHealthMonitorService().check();
      } catch {
        /* noop */
      }
    }, REFRESH_MS);
    this.unsub = getIntelligenceHealthMonitorService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const svc = getIntelligenceHealthMonitorService();
    const latest = svc.getLatest();
    const history = svc.getHistory(SPARKLINE_LIMIT);

    // Panel chip = overall score percentage when known.
    this.setCount(latest ? Math.round(latest.overallScore * 100) : 0);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderGauge(latest)}
      ${renderSparkline(history)}
      ${renderComponents(latest)}
      ${renderFooter(latest)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const btn = root.querySelector<HTMLButtonElement>('#ihmRunCheck');
      btn?.addEventListener('click', () => {
        getIntelligenceHealthMonitorService().check();
      });
    }, 0);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderGauge(snapshot: SystemHealthSnapshot | null): string {
  if (!snapshot) {
    return `<div style="padding:18px;border:1px dashed var(--border-subtle,#333);border-radius:6px;text-align:center;color:var(--text-secondary,#aaa);font-size:12px;">No health checks yet. Click <strong>Run Check</strong> to begin.</div>`;
  }
  const pct = Math.round(snapshot.overallScore * 100);
  const color = STATUS_COLOR[snapshot.overallStatus];
  return `<div style="display:flex;align-items:center;gap:18px;padding:14px;border:1px solid var(--border-subtle,#333);border-radius:6px;background:var(--surface-2,#1a1a1a);">
    <div style="position:relative;width:84px;height:84px;flex-shrink:0;">
      <svg viewBox="0 0 36 36" style="width:100%;height:100%;transform:rotate(-90deg);">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-3,#222)" stroke-width="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="${color}" stroke-width="3"
          stroke-dasharray="${(pct * 94.2 / 100).toFixed(2)} 94.2" stroke-linecap="round" />
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:${color};">${pct}%</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">System Status</span>
      <span style="font-size:18px;font-weight:600;color:${color};text-transform:capitalize;">${escapeHtml(snapshot.overallStatus)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">Mean across ${snapshot.components.length} component${snapshot.components.length === 1 ? '' : 's'}</span>
    </div>
  </div>`;
}

function renderSparkline(history: readonly SystemHealthSnapshot[]): string {
  if (history.length === 0) return '';
  // history is LIFO — flip to chronological for the spark.
  const chrono: SystemHealthSnapshot[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const snap = history[i];
    if (snap) chrono.push(snap);
  }
  const w = 220;
  const h = 32;
  const step = chrono.length > 1 ? w / (chrono.length - 1) : 0;
  const points = chrono.map((s, i) => `${(i * step).toFixed(2)},${(h - s.overallScore * h).toFixed(2)}`).join(' ');
  return `<div style="display:flex;flex-direction:column;gap:3px;">
    <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Recent ${chrono.length} check${chrono.length === 1 ? '' : 's'}</span>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;border:1px solid var(--border-subtle,#333);border-radius:3px;background:var(--surface-2,#1a1a1a);">
      <polyline fill="none" stroke="#4a9eff" stroke-width="1.5" points="${points}" />
    </svg>
  </div>`;
}

function renderComponents(snapshot: SystemHealthSnapshot | null): string {
  if (!snapshot || snapshot.components.length === 0) {
    return '';
  }
  const rows = snapshot.components.map((c) => renderComponentRow(c)).join('');
  return `<div style="display:flex;flex-direction:column;gap:6px;">
    <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Components</span>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;">${rows}</ul>
  </div>`;
}

function renderComponentRow(c: ComponentHealth): string {
  const pct = Math.round(c.score * 100);
  const color = COMPONENT_STATUS_COLOR[c.status];
  return `<li style="display:grid;grid-template-columns:12px 140px 1fr 50px;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);font-size:12px;">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>
    <span style="font-weight:500;">${escapeHtml(c.label)}</span>
    <div style="display:flex;flex-direction:column;gap:3px;min-width:0;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.detail)}</span>
      <div style="height:4px;background:var(--surface-3,#222);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};"></div>
      </div>
    </div>
    <span style="font-family:ui-monospace,monospace;text-align:right;color:${color};">${pct}%</span>
  </li>`;
}

function renderFooter(snapshot: SystemHealthSnapshot | null): string {
  const last = snapshot
    ? `Last checked ${escapeHtml(new Date(snapshot.checkedAt).toISOString())}`
    : 'Never checked';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--text-secondary,#aaa);">
    <span>${last}</span>
    <button id="ihmRunCheck" style="padding:4px 12px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">Run Check</button>
  </div>`;
}
