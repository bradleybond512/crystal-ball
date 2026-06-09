import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchBitcoinAbuseFeed,
  fetchBitcoinAddressCheck,
  formatSatoshisAsBtc,
  isPlausibleBtcAddress,
  truncateAddress,
  type AddressCheckResult,
  type BitcoinAbuseFeed,
  type ScamAddressCategory,
  type ScamAddressEntry,
  type ScamDomainEntry,
} from '@/services/crypto/bitcoin-abuse-service';

type Tab = 'addresses' | 'domains' | 'lookup';

const TAB_STORAGE_KEY = 'cb:bitcoin-abuse-tab';
const TAB_LABELS: Record<Tab, string> = {
  addresses: 'Scam Addresses',
  domains: 'Scam Domains',
  lookup: 'Address Lookup',
};

const CATEGORY_COLOR: Record<ScamAddressCategory, string> = {
  scam: 'rgba(248,113,113,0.18)',
  ransomware: 'rgba(220,38,38,0.28)',
  darknet: 'rgba(124,58,237,0.20)',
  phishing: 'rgba(245,158,11,0.20)',
  mixer: 'rgba(34,197,94,0.18)',
  mining: 'rgba(96,165,250,0.16)',
  other: 'rgba(255,255,255,0.08)',
};

export class BitcoinAbusePanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private feed: BitcoinAbuseFeed | null = null;
  private feedLoading = false;
  private lookupAddress = '';
  private lookupResult: AddressCheckResult | null = null;
  private lookupLoading = false;
  private lookupError: string | null = null;

  constructor() {
    super({
      id: 'bitcoin-abuse',
      title: 'Bitcoin Abuse',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'CryptoScamDB scam-address feed + blockchain.info chain lookup. Refresh ≈ every 6h.',
    });
    this.render();
    queueMicrotask(() => { void this.loadFeed(); });
  }

  private async loadFeed(): Promise<void> {
    if (this.feedLoading) return;
    this.feedLoading = true;
    try {
      this.feed = await fetchBitcoinAbuseFeed();
      this.setCount(this.feed.addresses.length);
    } finally {
      this.feedLoading = false;
      this.render();
    }
  }

  private async runLookup(): Promise<void> {
    const trimmed = this.lookupAddress.trim();
    if (!trimmed) {
      this.lookupError = 'Enter a BTC address to check.';
      this.render();
      return;
    }
    if (!isPlausibleBtcAddress(trimmed)) {
      this.lookupError = 'Doesn’t look like a valid BTC address (P2PKH / P2SH / bech32).';
      this.lookupResult = null;
      this.render();
      return;
    }
    this.lookupError = null;
    this.lookupLoading = true;
    this.render();
    try {
      this.lookupResult = await fetchBitcoinAddressCheck(trimmed);
    } finally {
      this.lookupLoading = false;
      this.render();
    }
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['addresses', 'domains', 'lookup'];
    return `<div class="bta-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs.map((tab) => {
      const active = tab === this.activeTab;
      return `<button class="bta-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px">${escapeHtml(TAB_LABELS[tab])}</button>`;
    }).join('')}</div>`;
  }

  private renderAddresses(): string {
    if (!this.feed && this.feedLoading) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">Loading scam-address feed…</div>`;
    }
    const addresses = this.feed?.addresses ?? [];
    if (addresses.length === 0) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">No scam addresses returned. ${this.feed?.degraded ? 'Upstream degraded — try again later.' : ''}</div>${this.renderFooter()}`;
    }
    const rows = addresses.slice(0, 200).map((entry) => this.renderAddressRow(entry)).join('');
    return `<table class="eq-table" style="width:100%;font-size:12px">
      <thead><tr><th>Address</th><th>Category</th><th style="text-align:right">Reports</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="opacity:0.65;font-size:11px;margin-top:6px">Showing ${Math.min(addresses.length, 200)} of ${addresses.length} addresses.</div>
    ${this.renderFooter()}`;
  }

  private renderAddressRow(entry: ScamAddressEntry): string {
    const display = escapeHtml(truncateAddress(entry.address));
    const fullTitle = escapeHtml(entry.address);
    const name = entry.name ? `<div style="opacity:0.7;font-size:10px">${escapeHtml(entry.name)}</div>` : '';
    return `<tr>
      <td><code title="${fullTitle}" style="font-size:11px">${display}</code>${name}</td>
      <td>${categoryBadge(entry.category)}</td>
      <td style="text-align:right">${entry.reportCount.toLocaleString()}</td>
    </tr>`;
  }

  private renderDomains(): string {
    if (!this.feed && this.feedLoading) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">Loading scam-domain feed…</div>`;
    }
    const domains = this.feed?.domains ?? [];
    if (domains.length === 0) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">No scam domains returned.</div>${this.renderFooter()}`;
    }
    const rows = domains.slice(0, 200).map((entry) => this.renderDomainRow(entry)).join('');
    return `<table class="eq-table" style="width:100%;font-size:12px">
      <thead><tr><th>Domain</th><th>Category</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="opacity:0.65;font-size:11px;margin-top:6px">Showing ${Math.min(domains.length, 200)} of ${domains.length} domains.</div>
    ${this.renderFooter()}`;
  }

  private renderDomainRow(entry: ScamDomainEntry): string {
    return `<tr>
      <td>${escapeHtml(entry.domain)}</td>
      <td>${categoryBadge(entry.category)}</td>
      <td>${statusBadge(entry.status)}</td>
    </tr>`;
  }

  private renderLookup(): string {
    const valueAttr = escapeHtml(this.lookupAddress);
    const errorBlock = this.lookupError ? `<div style="color:#fca5a5;font-size:11px;margin-top:6px">${escapeHtml(this.lookupError)}</div>` : '';
    let result = '';
    if (this.lookupLoading) {
      result = `<div style="padding:12px 0;opacity:0.7">Checking…</div>`;
    } else if (this.lookupResult) {
      result = this.renderLookupResult(this.lookupResult);
    }
    return `<form class="bta-lookup-form" style="display:flex;gap:6px">
      <input type="text" class="bta-lookup-input" placeholder="BTC address (1…, 3…, bc1…)" value="${valueAttr}"
        autocomplete="off" spellcheck="false"
        style="flex:1;padding:6px 10px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:13px;font-family:monospace" />
      <button class="bta-lookup-btn" type="submit"
        style="padding:6px 12px;border:1px solid rgba(96,165,250,0.4);background:rgba(96,165,250,0.18);color:inherit;border-radius:4px;cursor:pointer;font-size:12px">Check</button>
    </form>
    ${errorBlock}
    ${result}
    ${this.renderFooter()}`;
  }

  private renderLookupResult(result: AddressCheckResult): string {
    const scam = this.renderScamBlock(result);
    const chain = this.renderChainBlock(result);
    return `<div style="margin-top:8px"><code style="font-size:11px;opacity:0.8">${escapeHtml(result.address)}</code>${scam}${chain}</div>`;
  }

  private renderScamBlock(result: AddressCheckResult): string {
    if (!result.scamMatch) {
      return `<div style="margin-top:6px;padding:6px 8px;background:rgba(34,197,94,0.14);border-left:3px solid #22c55e;border-radius:3px;color:#bbf7d0;font-size:12px">No scam-DB match.</div>`;
    }
    const match = result.scamMatch;
    const nameBlock = match.name
      ? `<div style="font-size:11px;opacity:0.85">${escapeHtml(match.name)}</div>`
      : '';
    return `<div style="margin-top:6px;padding:6px 8px;background:rgba(220,38,38,0.18);border-left:3px solid #dc2626;border-radius:3px">
      <strong style="color:#fca5a5">SCAM DB MATCH</strong> ${categoryBadge(match.category)}
      ${nameBlock}
      <div style="font-size:11px;opacity:0.7">${match.reportCount.toLocaleString()} reports</div>
    </div>`;
  }

  private renderChainBlock(result: AddressCheckResult): string {
    if (result.balanceSat === null && result.txCount === null) {
      return `<div style="opacity:0.7;font-size:11px;margin-top:4px">Chain lookup failed (${escapeHtml(result.source)}).</div>`;
    }
    const txCellText = result.txCount === null ? '—' : result.txCount.toLocaleString();
    return `<table class="eq-table" style="width:100%;font-size:12px;margin-top:6px">
      <tbody>
        <tr><td style="opacity:0.7">Balance</td><td><code>${escapeHtml(formatSatoshisAsBtc(result.balanceSat))}</code></td></tr>
        <tr><td style="opacity:0.7">Transactions</td><td>${txCellText}</td></tr>
      </tbody>
    </table>`;
  }

  private renderFooter(): string {
    if (!this.feed || this.feed.generatedAt.startsWith('1970')) {
      const placeholder = this.feed?.degraded
        ? `Degraded: ${escapeHtml(this.feed.source)}`
        : 'Awaiting first refresh';
      return `<div style="margin-top:8px;font-size:11px;opacity:0.6">${placeholder}</div>`;
    }
    const degradedSuffix = this.feed.degraded ? ' (degraded)' : '';
    return `<div style="margin-top:8px;font-size:11px;opacity:0.6;display:flex;justify-content:space-between">
      <span>${escapeHtml(this.feed.source)}${degradedSuffix}</span>
      <span>Generated ${escapeHtml(this.feed.generatedAt)}</span>
    </div>`;
  }

  private render(): void {
    let body = '';
    switch (this.activeTab) {
      case 'addresses': { body = this.renderAddresses(); break; }
      case 'domains': { body = this.renderDomains(); break; }
      case 'lookup': { body = this.renderLookup(); break; }
    }
    this.setContent(`${this.renderTabStrip()}${body}`, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.bta-tab')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
      });
    }
    const form = root.querySelector<HTMLFormElement>('.bta-lookup-form');
    const input = root.querySelector<HTMLInputElement>('.bta-lookup-input');
    if (form && input) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.lookupAddress = input.value;
        void this.runLookup();
      });
      input.addEventListener('input', () => { this.lookupAddress = input.value; });
      // Preserve focus + caret across re-render on the lookup tab.
      if (this.activeTab === 'lookup') {
        const len = input.value.length;
        input.focus();
        try { input.setSelectionRange(len, len); } catch { /* noop */ }
      }
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function categoryBadge(category: ScamAddressCategory): string {
  return `<span style="padding:1px 6px;border-radius:3px;background:${CATEGORY_COLOR[category]};font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(category)}</span>`;
}

function statusBadge(status: 'active' | 'inactive' | 'unknown'): string {
  const colors: Record<typeof status, string> = {
    active: 'rgba(248,113,113,0.22)',
    inactive: 'rgba(120,120,120,0.18)',
    unknown: 'rgba(255,255,255,0.08)',
  };
  return `<span style="padding:1px 6px;border-radius:3px;background:${colors[status]};font-size:10px;text-transform:uppercase">${escapeHtml(status)}</span>`;
}

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'addresses' || stored === 'domains' || stored === 'lookup') return stored;
  } catch { /* noop */ }
  return 'addresses';
}
