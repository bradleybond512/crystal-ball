import { Panel } from './Panel';
import type { StrikePackage } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  active: '#dc2626',
  forming: '#ca8a04',
  deploying: '#7c3aed',
  transit: '#3b82f6',
  in_port: '#059669',
  unknown: '#64748b',
};

const STATUS_BG: Record<string, string> = {
  active: '#fecaca',
  forming: '#fef08a',
  deploying: '#e9d5ff',
  transit: '#bfdbfe',
  in_port: '#a7f3d0',
  unknown: '#e2e8f0',
};

const DOMAIN_ICON: Record<string, string> = {
  naval: '\u{1F6A2}',  // ship
  air: '\u2708',        // airplane
};

export class StrikePackagePanel extends Panel {
  private packages: StrikePackage[] = [];
  private expandedId: string | null = null;
  private clickHandler: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'strike-package',
      title: 'Strike Packages',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active naval strike groups and detected air strike formations with route prediction',
    });
    this.showLoading('Detecting strike packages\u2026');
  }

  setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  update(packages: StrikePackage[]): void {
    this.packages = [...packages].sort((a, b) => b.importance - a.importance);
    this.setCount(this.packages.length);
    this.render();
  }

  getPackages(): StrikePackage[] {
    return this.packages;
  }

  private render(): void {
    if (this.packages.length === 0) {
      this.setContent('<div class="panel-empty">No active strike packages detected</div>');
      return;
    }

    const rows = this.packages.map(pkg => {
      const isExpanded = this.expandedId === pkg.id;
      const icon = DOMAIN_ICON[pkg.domain] || '\u2708';
      const statusColor = STATUS_COLORS[pkg.status] || '#64748b';
      const statusBg = STATUS_BG[pkg.status] || '#e2e8f0';
      const statusLabel = pkg.status.replace(/_/g, ' ').toUpperCase();
      const compSummary = pkg.composition.map(u => `${u.type}\u00d7${u.count}`).join(' + ');
      const topDest = pkg.prediction.destinations[0];
      const destStr = topDest && topDest.name !== 'Unknown' ? ` \u2022 ${topDest.name} ${topDest.probability}%` : '';
      const headingStr = pkg.speed > 0 ? `${Math.round(pkg.heading)}\u00b0 at ${Math.round(pkg.speed)}kts` : 'Stationary';

      let expandedHtml = '';
      if (isExpanded) {
        const compPills = pkg.composition.map(u =>
          `<span style="background:#1e293b;padding:2px 6px;border-radius:3px;font-size:10px;display:inline-block;margin:2px">${u.type} \u00d7${u.count}</span>`
        ).join('');

        const destRows = pkg.prediction.destinations.slice(0, 5).map(d =>
          `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${d.name}: ${d.probability}% \u2014 ${d.reasoning}</div>`
        ).join('');

        const aiBlock = pkg.aiAssessment
          ? `<div style="margin-top:8px">
              <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">AI Assessment</div>
              <div style="margin-top:4px;padding:6px 8px;background:#1e293b;border-radius:4px;border-left:2px solid #3b82f6;font-size:11px;color:#cbd5e1">${pkg.aiAssessment}</div>
            </div>`
          : `<div style="margin-top:8px;font-size:11px;color:#475569;font-style:italic">AI assessment unavailable</div>`;

        expandedHtml = `
          <div style="padding:8px 12px 10px;border-top:1px solid #1e293b">
            <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Composition</div>
            <div style="margin-top:4px">${compPills}</div>
            <div style="margin-top:8px">
              <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Route Prediction</div>
              <div style="margin-top:4px;font-size:11px">${headingStr}</div>
              ${destRows}
            </div>
            ${aiBlock}
            <button class="sp-focus-btn" data-lat="${pkg.lat}" data-lon="${pkg.lon}" style="margin-top:8px;background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer">Focus on map</button>
          </div>`;
      }

      return `
        <div class="sp-card" data-id="${pkg.id}" style="border-bottom:1px solid #1e293b;${isExpanded ? 'border-left:3px solid #3b82f6;' : ''}cursor:pointer">
          <div class="sp-header" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;gap:6px;align-items:center;min-width:0">
              <span style="font-size:14px;flex-shrink:0">${icon}</span>
              <span style="font-weight:600;color:${pkg.domain === 'naval' ? '#f59e0b' : '#3b82f6'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pkg.name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:10px;background:${statusColor};padding:1px 6px;border-radius:4px;color:${statusBg}">${statusLabel}</span>
              <span style="color:#475569;font-size:10px">${isExpanded ? '\u25BC' : '\u25B6'}</span>
            </div>
          </div>
          <div style="padding:0 12px 8px;color:#94a3b8;font-size:11px">${compSummary} \u2022 ${headingStr}${destStr}</div>
          ${expandedHtml}
        </div>`;
    }).join('');

    this.setContent(`<div style="font-size:12px">${rows}</div>`);
    this.attachListeners();
  }

  private attachListeners(): void {
    const el = this.element;
    el.querySelectorAll<HTMLElement>('.sp-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest<HTMLElement>('.sp-card');
        const id = card?.dataset.id;
        if (!id) return;
        this.expandedId = this.expandedId === id ? null : id;
        this.render();
      });
    });

    el.querySelectorAll<HTMLElement>('.sp-focus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lat = parseFloat(btn.dataset.lat || '0');
        const lon = parseFloat(btn.dataset.lon || '0');
        this.clickHandler?.(lat, lon);
      });
    });
  }

  onActivate(): void {
    this.clearNewBadge();
  }
}
