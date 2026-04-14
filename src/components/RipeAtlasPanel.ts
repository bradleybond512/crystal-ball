import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { RipeAtlasStatus } from '@/services/ripe-atlas';

export class RipeAtlasPanel extends Panel {
  constructor() {
    super({ id: 'ripe-atlas', title: 'RIPE Atlas', showCount: false, trackActivity: false });
    this.showLoading('Loading RIPE Atlas data...');
  }

  update(data: RipeAtlasStatus): void {
    const { totalConnectedProbes, anchors } = data;
    const countrySet = new Set(anchors.map(a => a.country));

    const rows = anchors.slice(0, 20).map(a =>
      `<tr><td>${escapeHtml(a.fqdn)}</td><td>${escapeHtml(a.country)}</td></tr>`
    ).join('');

    this.setContent(`
      <div class="panel-summary">
        <span class="stat">${totalConnectedProbes.toLocaleString()} connected probes</span>
        <span class="stat">${anchors.length} anchors in ${countrySet.size} countries</span>
      </div>
      <table class="panel-table">
        <thead><tr><th>Anchor</th><th>Country</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  }
}
