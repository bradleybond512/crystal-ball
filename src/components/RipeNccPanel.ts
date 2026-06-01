import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { RipeRoutingStatus } from '@/services/ripe-ncc';

export class RipeNccPanel extends Panel {
  constructor() {
    super({ id: 'ripe-ncc', title: 'RIPE NCC BGP', showCount: false, trackActivity: false });
    this.showLoading('Loading RIPE NCC routing status...');
  }

  update(data: RipeRoutingStatus | null): void {
    if (!data) {
      this.showError('RIPE NCC routing status unavailable');
      return;
    }

    const v4Pct = data.v4TotalPeers > 0
      ? Math.round((data.v4PeersSeeing / data.v4TotalPeers) * 100)
      : 0;
    const v6Pct = data.v6TotalPeers > 0
      ? Math.round((data.v6PeersSeeing / data.v6TotalPeers) * 100)
      : 0;
    const originList = data.origins.length > 0
      ? data.origins.map(a => `AS${a}`).join(', ')
      : '—';

    const seenRow = (label: string, seen: RipeRoutingStatus['firstSeen']) =>
      seen
        ? `<tr><td>${label}</td><td>${escapeHtml(seen.prefix)} · AS${escapeHtml(seen.origin)}</td><td>${escapeHtml((seen.time || '').replace('T', ' '))}</td></tr>`
        : '';

    this.setContent(`
      <div class="panel-summary">
        <span class="stat">${escapeHtml(data.resource)}</span>
        <span class="stat">IPv4 visibility ${v4Pct}% (${data.v4PeersSeeing}/${data.v4TotalPeers} RIS peers)</span>
        <span class="stat">IPv6 visibility ${v6Pct}% (${data.v6PeersSeeing}/${data.v6TotalPeers} RIS peers)</span>
        <span class="stat">Origin: ${escapeHtml(originList)}</span>
        <span class="stat">${data.lessSpecifics} less-specific · ${data.moreSpecifics} more-specific</span>
      </div>
      <table class="panel-table">
        <thead><tr><th>Event</th><th>Prefix · Origin</th><th>Time (UTC)</th></tr></thead>
        <tbody>
          ${seenRow('First seen', data.firstSeen)}
          ${seenRow('Last seen', data.lastSeen)}
        </tbody>
      </table>
    `);
  }
}
