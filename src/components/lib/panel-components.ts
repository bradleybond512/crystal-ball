import { escapeHtml } from '@/utils/sanitize';

function severityColor(severity: number): string {
  if (severity >= 4) return 'var(--severity-critical)';
  if (severity >= 3) return 'var(--severity-high)';
  if (severity >= 2) return 'var(--severity-medium)';
  if (severity >= 1) return 'var(--severity-low)';
  return 'var(--severity-ok)';
}

function severityBg(severity: number): string {
  const color = severityColor(severity);
  return `color-mix(in srgb, ${color} 12%, transparent)`;
}

function statusColor(status: 'nominal' | 'elevated' | 'stressed' | 'critical'): string {
  if (status === 'critical') return 'var(--severity-critical)';
  if (status === 'stressed') return 'var(--severity-high)';
  if (status === 'elevated') return 'var(--severity-medium)';
  return 'var(--severity-ok)';
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function createPanelHeader(title: string, subtitle?: string, badge?: string): string {
  const subtitleHtml = subtitle
    ? `<div style="font-size:11px;opacity:0.65;margin-top:2px">${escapeHtml(subtitle)}</div>`
    : '';
  const badgeHtml = badge
    ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:rgba(255,255,255,0.1);margin-left:8px">${escapeHtml(badge)}</span>`
    : '';
  return `<div style="padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,0.08)">
  <div style="display:flex;align-items:center">
    <span style="font-size:13px;font-weight:600">${escapeHtml(title)}</span>${badgeHtml}
  </div>${subtitleHtml}
</div>`;
}

export function createCard(title: string, body: string, severity?: number, footer?: string): string {
  const borderColor = severity === undefined ? 'rgba(255,255,255,0.1)' : severityColor(severity);
  const bg = severity === undefined ? 'rgba(255,255,255,0.04)' : severityBg(severity);
  const footerHtml = footer
    ? `<div style="font-size:10px;opacity:0.55;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.07)">${escapeHtml(footer)}</div>`
    : '';
  return `<div style="padding:10px 12px;border-radius:6px;background:${bg};border-left:3px solid ${borderColor};margin-bottom:8px">
  <div style="font-size:12px;font-weight:600;margin-bottom:4px">${escapeHtml(title)}</div>
  <div style="font-size:12px;opacity:0.85">${body}</div>${footerHtml}
</div>`;
}

export function createBadge(label: string, variant: 'severity' | 'domain' | 'status', value: string | number): string {
  let color: string;
  if (variant === 'severity') {
    color = typeof value === 'number' ? severityColor(value) : `var(--severity-${String(value)})`;
  } else if (variant === 'domain') {
    color = `var(--domain-${String(value)})`;
  } else {
    color = `var(--severity-${String(value)})`;
  }
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span style="display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;color:${color};background:${bg}">${escapeHtml(label)}</span>`;
}

export function createTimeline(events: { timestamp: number; label: string; severity: number; detail?: string }[]): string {
  if (events.length === 0) {
    return '<div style="opacity:0.5;font-size:12px;padding:8px 0">No events.</div>';
  }
  const rows = events.map((ev) => {
    const color = severityColor(ev.severity);
    const detailHtml = ev.detail
      ? `<div style="font-size:10px;opacity:0.6;margin-top:2px">${escapeHtml(ev.detail)}</div>`
      : '';
    return `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
    <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;width:12px">
      <div style="width:10px;height:10px;border-radius:50%;background:${color};margin-top:2px"></div>
      <div style="width:1px;flex:1;background:rgba(255,255,255,0.1);margin-top:2px"></div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;font-weight:500">${escapeHtml(ev.label)}</span>
        <span style="font-size:10px;opacity:0.5;flex-shrink:0;margin-left:8px">${escapeHtml(formatTimestamp(ev.timestamp))}</span>
      </div>${detailHtml}
    </div>
  </div>`;
  }).join('');
  return `<div style="padding:4px 0">${rows}</div>`;
}

export function createStatusIndicator(status: 'nominal' | 'elevated' | 'stressed' | 'critical', label: string): string {
  const color = statusColor(status);
  const pulse = status === 'critical'
    ? ';animation:pulse 1.5s ease-in-out infinite'
    : '';
  return `<div style="display:flex;align-items:center;gap:7px">
  <div style="width:9px;height:9px;border-radius:50%;background:${color}${pulse};flex-shrink:0"></div>
  <span style="font-size:12px">${escapeHtml(label)}</span>
  <span style="font-size:10px;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(status)}</span>
</div>`;
}

export function createStatRow(stats: { label: string; value: string | number; trend?: 'up' | 'down' | 'stable' }[]): string {
  const cells = stats.map((stat) => {
    let trendHtml = '';
    if (stat.trend === 'up') {
      trendHtml = '<span style="color:var(--severity-high);font-size:10px;margin-left:3px">▲</span>';
    } else if (stat.trend === 'down') {
      trendHtml = '<span style="color:var(--severity-ok);font-size:10px;margin-left:3px">▼</span>';
    } else if (stat.trend === 'stable') {
      trendHtml = '<span style="opacity:0.4;font-size:10px;margin-left:3px">—</span>';
    }
    return `<div style="flex:1;text-align:center;padding:6px 4px">
    <div style="font-size:16px;font-weight:600">${escapeHtml(String(stat.value))}${trendHtml}</div>
    <div style="font-size:10px;opacity:0.6;margin-top:2px">${escapeHtml(stat.label)}</div>
  </div>`;
  }).join('<div style="width:1px;background:rgba(255,255,255,0.08);align-self:stretch"></div>');
  return `<div style="display:flex;gap:0;border-radius:6px;background:rgba(255,255,255,0.04);overflow:hidden">${cells}</div>`;
}

export function createEmptyState(message: string, icon?: string): string {
  const iconHtml = icon
    ? `<div style="font-size:28px;margin-bottom:8px">${escapeHtml(icon)}</div>`
    : '';
  return `<div style="text-align:center;padding:24px 16px;opacity:0.5">
  ${iconHtml}<div style="font-size:12px">${escapeHtml(message)}</div>
</div>`;
}

export function createErrorState(message: string): string {
  return `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:6px;background:color-mix(in srgb, var(--severity-critical) 10%, transparent);border-left:3px solid var(--severity-critical)">
  <span style="font-size:14px;flex-shrink:0">⚠</span>
  <span style="font-size:12px;color:var(--severity-critical)">${escapeHtml(message)}</span>
</div>`;
}
