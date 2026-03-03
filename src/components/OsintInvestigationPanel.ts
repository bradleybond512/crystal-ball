import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { lookupDomain, searchUsername, clearOsintCache } from '@/services/osint';
import { detectSearchMode } from '@/types/osint';
import type {
  DomainIntelligence,
  UsernameSearchResult,
  OsintSearchMode,
} from '@/types/osint';

export class OsintInvestigationPanel extends Panel {
  private currentMode: OsintSearchMode = 'domain';
  private lastDomainResult: DomainIntelligence | null = null;
  private lastUsernameResult: UsernameSearchResult | null = null;

  constructor() {
    super({
      id: 'osint-investigation',
      title: t('panels.osintInvestigation') || 'OSINT Investigation',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Open-source intelligence: WHOIS · DNS · SSL certificates · Wayback Machine snapshots · Username enumeration across 100+ platforms.',
    });
    this.renderSearchInterface();
  }

  private renderSearchInterface(): void {
    const html = `
      <div class="osint-panel">
        <div class="osint-controls">
          <div class="osint-mode-toggle">
            <button class="osint-mode-btn osint-mode-domain active" data-mode="domain">Domain</button>
            <button class="osint-mode-btn osint-mode-username" data-mode="username">Username</button>
          </div>
          <div class="osint-search-row">
            <input
              class="osint-search-input"
              type="text"
              placeholder="Enter domain (e.g. example.com) or username…"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="osint-search-btn">Search</button>
          </div>
        </div>
        <div class="osint-results"></div>
      </div>
    `;
    this.setContent(html);

    // Attach event handlers after rendering
    requestAnimationFrame(() => this.attachHandlers());
  }

  private attachHandlers(): void {
    const root = this.content;
    const input = root.querySelector<HTMLInputElement>('.osint-search-input');
    const searchBtn = root.querySelector<HTMLButtonElement>('.osint-search-btn');
    const modeButtons = root.querySelectorAll<HTMLButtonElement>('.osint-mode-btn');

    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset['mode'] as OsintSearchMode;
        this.setMode(mode);
      });
    });

    if (input) {
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          const detected = detectSearchMode(input.value);
          this.setMode(detected);
        }
      });

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') void this.runSearch(input.value.trim());
      });
    }

    if (searchBtn && input) {
      searchBtn.addEventListener('click', () => void this.runSearch(input.value.trim()));
    }
  }

  private setMode(mode: OsintSearchMode): void {
    this.currentMode = mode;
    const root = this.content;
    const modeButtons = root.querySelectorAll<HTMLButtonElement>('.osint-mode-btn');
    modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset['mode'] === mode);
    });
    const input = root.querySelector<HTMLInputElement>('.osint-search-input');
    if (input) {
      input.placeholder =
        mode === 'domain'
          ? 'Enter domain (e.g. example.com)…'
          : 'Enter username (e.g. johndoe)…';
    }
    // Show previous results if any
    if (mode === 'domain' && this.lastDomainResult) {
      this.renderDomainResult(this.lastDomainResult);
    } else if (mode === 'username' && this.lastUsernameResult) {
      this.renderUsernameResult(this.lastUsernameResult);
    }
  }

  private async runSearch(query: string): Promise<void> {
    if (!query) return;
    const resultsEl = this.content.querySelector<HTMLElement>('.osint-results');
    if (!resultsEl) return;

    resultsEl.innerHTML = '<div class="osint-loading">Searching…</div>';

    try {
      if (this.currentMode === 'domain') {
        const result = await lookupDomain(query);
        this.lastDomainResult = result;
        this.renderDomainResult(result);
      } else {
        const result = await searchUsername(query);
        this.lastUsernameResult = result;
        this.renderUsernameResult(result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultsEl.innerHTML = `<div class="osint-error">${escapeHtml(msg)}</div>`;
    }
  }

  private renderDomainResult(result: DomainIntelligence): void {
    const resultsEl = this.content.querySelector<HTMLElement>('.osint-results');
    if (!resultsEl) return;

    const cachedBadge = result.cached
      ? '<span class="osint-cached-badge">cached</span>'
      : '';

    const whoisHtml = result.whois
      ? `<div class="osint-card">
          <div class="osint-card-title">WHOIS ${cachedBadge}</div>
          <table class="osint-table">
            <tr><td>Registrar</td><td>${escapeHtml(result.whois.registrar || '—')}</td></tr>
            <tr><td>Created</td><td>${escapeHtml(result.whois.created_date || '—')}</td></tr>
            <tr><td>Expires</td><td>${escapeHtml(result.whois.expires_date || '—')}</td></tr>
            <tr><td>Updated</td><td>${escapeHtml(result.whois.updated_date || '—')}</td></tr>
            <tr><td>Registrant</td><td>${escapeHtml(result.whois.registrant || '—')}</td></tr>
            <tr><td>NS</td><td>${result.whois.name_servers.map(s => escapeHtml(s)).join('<br>')}</td></tr>
          </table>
        </div>`
      : '<div class="osint-card osint-card-empty">WHOIS data unavailable</div>';

    const dnsHtml = `<div class="osint-card">
      <div class="osint-card-title">DNS Records</div>
      <table class="osint-table">
        <tr><td>A</td><td>${result.dns.a.map(s => escapeHtml(s)).join('<br>') || '—'}</td></tr>
        <tr><td>NS</td><td>${result.dns.ns.map(s => escapeHtml(s)).join('<br>') || '—'}</td></tr>
        <tr><td>MX</td><td>${result.dns.mx.map(r => `${escapeHtml(r.host)} (${r.priority})`).join('<br>') || '—'}</td></tr>
        <tr><td>TXT</td><td>${result.dns.txt.slice(0, 3).map(s => escapeHtml(s)).join('<br>') || '—'}</td></tr>
      </table>
    </div>`;

    const sslHtml = result.ssl
      ? `<div class="osint-card ${result.ssl.is_expired ? 'osint-card-warning' : ''}">
          <div class="osint-card-title">SSL Certificate${result.ssl.is_expired ? ' ⚠ Expired' : ''}</div>
          <table class="osint-table">
            <tr><td>Subject</td><td>${escapeHtml(result.ssl.subject)}</td></tr>
            <tr><td>Issuer</td><td>${escapeHtml(result.ssl.issuer)}</td></tr>
            <tr><td>Valid from</td><td>${escapeHtml(result.ssl.valid_from)}</td></tr>
            <tr><td>Valid until</td><td>${escapeHtml(result.ssl.valid_until)}</td></tr>
            <tr><td>SANs</td><td>${result.ssl.sans.slice(0, 5).map(s => escapeHtml(s)).join('<br>') || '—'}</td></tr>
          </table>
        </div>`
      : '<div class="osint-card osint-card-empty">SSL data unavailable</div>';

    const vtHtml = result.virustotal_score !== null && result.virustotal_score !== undefined
      ? `<div class="osint-card ${result.virustotal_score > 0.1 ? 'osint-card-warning' : ''}">
          <div class="osint-card-title">VirusTotal</div>
          <div class="osint-vt-score">Threat score: ${Math.round(result.virustotal_score * 100)}%</div>
        </div>`
      : '';

    const waybackHtml = result.wayback_snapshots.length > 0
      ? `<div class="osint-card">
          <div class="osint-card-title">Wayback Machine (${result.wayback_snapshots.length} snapshots)</div>
          <ul class="osint-wayback-list">
            ${result.wayback_snapshots.slice(0, 5).map(snap =>
              `<li><a href="${escapeHtml(snap.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(snap.timestamp)}</a></li>`
            ).join('')}
          </ul>
        </div>`
      : '';

    resultsEl.innerHTML = `
      <div class="osint-domain-results">
        <div class="osint-results-header">
          Results for <strong>${escapeHtml(result.domain)}</strong>
          ${cachedBadge}
        </div>
        <div class="osint-cards-grid">
          ${whoisHtml}
          ${dnsHtml}
          ${sslHtml}
          ${vtHtml}
          ${waybackHtml}
        </div>
      </div>
    `;
  }

  private renderUsernameResult(result: UsernameSearchResult): void {
    const resultsEl = this.content.querySelector<HTMLElement>('.osint-results');
    if (!resultsEl) return;

    const found = result.found_on.filter(p => p.found);
    const cachedBadge = result.cached
      ? '<span class="osint-cached-badge">cached</span>'
      : '';

    const platformRows = result.found_on
      .sort((a, b) => (b.found ? 1 : 0) - (a.found ? 1 : 0))
      .map(p => {
        const statusClass = p.found ? 'osint-platform-found' : 'osint-platform-not-found';
        const statusIcon = p.found ? '✔' : '✗';
        const linkHtml = p.found
          ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.url)}</a>`
          : escapeHtml(p.url);
        return `<tr class="${statusClass}">
          <td class="osint-platform-status">${statusIcon}</td>
          <td class="osint-platform-name">${escapeHtml(p.platform)}</td>
          <td class="osint-platform-url">${linkHtml}</td>
        </tr>`;
      })
      .join('');

    resultsEl.innerHTML = `
      <div class="osint-username-results">
        <div class="osint-results-header">
          Username: <strong>${escapeHtml(result.username)}</strong>
          — Found on <strong>${found.length}</strong> of ${result.total_checked} platforms
          ${cachedBadge}
        </div>
        <table class="osint-table osint-platforms-table">
          <thead>
            <tr>
              <th></th>
              <th>Platform</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>${platformRows}</tbody>
        </table>
      </div>
    `;
  }

  /** Clear the OSINT cache and reset the panel. */
  public async clearCache(): Promise<void> {
    try {
      await clearOsintCache();
      this.lastDomainResult = null;
      this.lastUsernameResult = null;
      const resultsEl = this.content.querySelector<HTMLElement>('.osint-results');
      if (resultsEl) {
        resultsEl.innerHTML = '<div class="osint-empty">Cache cleared.</div>';
      }
    } catch {
      // Ignore errors when clearing cache
    }
  }
}
