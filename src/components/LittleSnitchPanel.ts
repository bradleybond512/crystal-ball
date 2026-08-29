import { Panel } from './Panel';
import type { LittleSnitchEnrichment, LittleSnitchSnapshot, SecurityPostureSnapshot } from '@/services/little-snitch';
import { emptyLittleSnitchSnapshot, emptySecurityPostureSnapshot, fetchLittleSnitchEnrichment, fetchSecurityPostureSnapshot } from '@/services/little-snitch';
import { escapeHtml } from '@/utils/sanitize';

export class LittleSnitchPanel extends Panel {
  private snapshot: LittleSnitchSnapshot = emptyLittleSnitchSnapshot('Waiting for Little Snitch export...');
  private posture: SecurityPostureSnapshot = emptySecurityPostureSnapshot('Waiting for security posture...');
  private selectedIndicator: string | null = null;
  private enrichment: LittleSnitchEnrichment | null = null;

  constructor() {
    super({
      id: 'little-snitch',
      title: 'Little Snitch',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Outbound app/network activity from a sanitized Little Snitch export. Crystal Ball stays unprivileged and never reads raw Little Snitch logs directly.',
    });
    this.content.addEventListener('click', event => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-ls-indicator]') : null;
      if (!target) return;
      const indicator = target.dataset.lsIndicator;
      if (!indicator) return;
      void this.selectIndicator(indicator);
    });
    this.render();
  }

  public update(snapshot: LittleSnitchSnapshot): void {
    this.snapshot = snapshot;
    this.setCount(snapshot.summary.totalConnections);
    void this.refreshPosture();
    this.render();
  }

  private async refreshPosture(): Promise<void> {
    this.posture = await fetchSecurityPostureSnapshot();
    this.render();
  }

  private async selectIndicator(indicator: string): Promise<void> {
    this.selectedIndicator = indicator;
    this.enrichment = null;
    this.render();
    this.enrichment = await fetchLittleSnitchEnrichment(indicator);
    this.render();
  }

  private render(): void {
    if (this.snapshot.sourceState !== 'ready') {
      this.setContent(renderSourceState(this.snapshot));
      return;
    }

    const summary = this.snapshot.summary;
    const rows = this.snapshot.entries.slice(0, 20).map(entry => `
      <tr class="${entry.decision === 'block' ? 'ct-row-high' : ''}" data-ls-indicator="${escapeHtml(entry.remoteIp ?? entry.remoteHost)}">
        <td>${escapeHtml(entry.app)}</td>
        <td>${decisionBadge(entry.decision)}</td>
        <td>${riskBadge(entry.risk.level, entry.risk.score)}</td>
        <td class="ids-ip">${escapeHtml(entry.remoteHost)}</td>
        <td class="ids-ip">${escapeHtml(entry.remoteIp ?? '-')}</td>
        <td>${escapeHtml(entry.direction)}</td>
        <td>${escapeHtml(entry.protocol)}</td>
        <td>${formatBytes(entry.bytesIn + entry.bytesOut)}</td>
        <td class="ids-time">${formatTs(entry.lastSeen)}</td>
      </tr>
    `).join('');

    this.setContent(`
      <div class="ids-panel-content little-snitch-panel-content">
        <div class="ls-health ls-health-${escapeHtml(this.snapshot.freshness.status)}">
          <strong>${escapeHtml(this.snapshot.freshness.status)}</strong>
          <span>${escapeHtml(this.snapshot.freshness.label)}</span>
        </div>
        <div class="ls-summary-grid">
          ${metricCard('Total', summary.totalConnections)}
          ${metricCard('Allowed', summary.allowedConnections)}
          ${metricCard('Blocked', summary.blockedConnections)}
          ${metricCard('High Risk', summary.highRiskConnections)}
          ${metricCard('New Destinations', summary.newDestinations)}
          ${metricCard('Outbound', formatBytes(summary.outboundBytes))}
          ${metricCard('Known Good', summary.allowlistHits)}
          ${metricCard('Persistence', this.posture.persistenceItems.length)}
        </div>
        ${securityPosture(this.posture)}
        ${enrichmentCard(this.selectedIndicator, this.enrichment)}
        ${riskFindings(summary.topRisks)}
        <div class="ls-toplists">
          <div><strong>Top Apps</strong>${listRows(summary.topApps)}</div>
          <div><strong>Top Domains</strong>${listRows(summary.topDomains)}</div>
        </div>
        <table class="ct-table ids-table">
          <thead>
            <tr><th>App</th><th>Decision</th><th>Risk</th><th>Remote Host</th><th>IP</th><th>Dir</th><th>Proto</th><th>Bytes</th><th>Last Seen</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
  }
}

function renderSourceState(snapshot: LittleSnitchSnapshot): string {
  if (snapshot.sourceState === 'empty') {
    return '<div class="panel-empty">Little Snitch exporter is healthy. No connections were recorded in the current window.</div>';
  }

  if (snapshot.sourceState === 'missing' && snapshot.error === 'Waiting for Little Snitch export...') {
    return '<div class="panel-empty">Waiting for the Little Snitch exporter...</div>';
  }

  let message: string;
  switch (snapshot.sourceState) {
    case 'missing': {
      message = 'Little Snitch export is not configured. Run the Crystal Ball Little Snitch setup to start the exporter.';
      break;
    }
    case 'stale': {
      message = 'Little Snitch export is stale. Check that the Little Snitch exporter is running and producing fresh snapshots.';
      break;
    }
    case 'permission-denied': {
      message = 'Little Snitch export cannot be read. Check the snapshot ownership and permissions, then restart the exporter.';
      break;
    }
    case 'invalid':
    case 'ready': {
      message = 'Little Snitch export is invalid. Run the Little Snitch exporter repair and try again.';
      break;
    }
  }

  const detail = snapshot.error ? `<br><span class="ids-time">${escapeHtml(snapshot.error)}</span>` : '';
  return `<div class="panel-empty">${message}${detail}</div>`;
}

function decisionBadge(decision: string): string {
  let cls = 'ids-src-unknown';
  if (decision === 'block') cls = 'ids-src-suricata';
  if (decision === 'allow') cls = 'ids-src-zeek_conn';
  return `<span class="ids-src-badge ${cls}">${escapeHtml(decision)}</span>`;
}

function riskBadge(level: string, score: number): string {
  return `<span class="ls-risk-badge ls-risk-${escapeHtml(level)}">${escapeHtml(level)} ${score}</span>`;
}

function metricCard(label: string, value: number | string): string {
  return `<div class="ls-metric"><span>${escapeHtml(label)}</span><strong>${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}</strong></div>`;
}

function listRows(rows: { name: string; count: number }[]): string {
  if (rows.length === 0) return '<div class="panel-empty">No data</div>';
  const items = rows.map(r => {
    const name = escapeHtml(r.name);
    const count = r.count.toLocaleString();
    return `<li><span>${name}</span><b>${count}</b></li>`;
  }).join('');
  return `<ul class="ls-toplist">${items}</ul>`;
}

function riskFindings(rows: LittleSnitchSnapshot['summary']['topRisks']): string {
  if (rows.length === 0) return '';
  const items = rows.map(row => `
    <li>
      <b>${escapeHtml(row.app)}</b>
      <span>${escapeHtml(row.remoteHost)}</span>
      <em>${escapeHtml(row.reasons.slice(0, 2).join(', '))}</em>
    </li>
  `).join('');
  return `<div class="ls-risk-findings"><strong>Review First</strong><ul>${items}</ul></div>`;
}

function securityPosture(posture: SecurityPostureSnapshot): string {
  if (!posture.available && posture.error) {
    return `<div class="ls-security-block"><strong>Security Health</strong><div class="panel-empty">${escapeHtml(posture.error)}</div></div>`;
  }
  const checks = posture.checks.slice(0, 5).map(check => `
    <li>
      <span class="ls-posture-dot ls-posture-${escapeHtml(check.status)}"></span>
      <b>${escapeHtml(check.label)}</b>
      <em>${escapeHtml(check.detail)}</em>
    </li>
  `).join('');
  const persistence = posture.persistenceItems.slice(0, 5).map(item => `
    <li>
      <span class="ls-risk-badge ls-risk-${escapeHtml(persistenceRiskLevel(item.risk))}">${escapeHtml(item.risk)}</span>
      <b>${escapeHtml(item.label)}</b>
      <em>${escapeHtml(item.kind)} · ${escapeHtml(item.command || item.path)}</em>
    </li>
  `).join('');
  return `
    <div class="ls-security-grid">
      <div class="ls-security-block"><strong>Security Health</strong><ul>${checks || '<li><em>No checks available</em></li>'}</ul></div>
      <div class="ls-security-block"><strong>Persistence Watch</strong><ul>${persistence || '<li><em>No persistence items found</em></li>'}</ul></div>
    </div>
  `;
}

function enrichmentCard(indicator: string | null, enrichment: LittleSnitchEnrichment | null): string {
  if (!indicator) return '';
  if (!enrichment) {
    return `<div class="ls-enrichment"><strong>Enrichment</strong><span class="ids-ip">${escapeHtml(indicator)}</span><div class="panel-empty">Checking providers...</div></div>`;
  }
  const providers = enrichment.providers.map(provider => `
    <li>
      <span class="ls-provider-${escapeHtml(provider.status)}">${escapeHtml(provider.status)}</span>
      <b>${escapeHtml(provider.name)}</b>
      <em>${escapeHtml(provider.summary)}</em>
    </li>
  `).join('');
  const signalItems = enrichment.signals.map(signal => `<span>${escapeHtml(signal)}</span>`).join('');
  const signals = enrichment.signals.length > 0
    ? `<div class="ls-signal-list">${signalItems}</div>`
    : '<div class="panel-empty">No threat signals returned by configured providers.</div>';
  return `
    <div class="ls-enrichment">
      <strong>Enrichment</strong>
      <span class="ids-ip">${escapeHtml(enrichment.value)}</span>
      ${signals}
      <ul>${providers || '<li><em>No providers checked</em></li>'}</ul>
      ${enrichment.error ? `<div class="ids-time">${escapeHtml(enrichment.error)}</div>` : ''}
    </div>
  `;
}

function persistenceRiskLevel(risk: string): string {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatTs(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
