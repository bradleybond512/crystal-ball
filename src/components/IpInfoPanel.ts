/**
 * IPInfo Lookup Panel — single + batch ipinfo.io queries with a
 * recent-lookups history sidebar.
 *
 * Tabs:
 *   • Lookup — single-IP input, result card, threat-context block,
 *              recent-lookups list (clickable to re-run).
 *   • Batch  — textarea (one IP per line, max 50) → results table.
 *
 * The sidecar (/api/security/ipinfo) handles upstream proxying + 1h
 * per-IP cache.
 */

import { Panel } from './Panel';
import {
  lookupIp,
  lookupIpBatch,
  isValidIp,
  crossReferenceThreats,
  recordHistory,
  loadHistoryFromStorage,
  saveHistoryToStorage,
  type HistoryEntry,
  type IpInfo,
  type IpThreatContext,
} from '@/services/security/ipinfo-service';
import {
  renderSingleLookupForm,
  renderResultCard,
  renderHistory,
  renderBatchForm,
  renderBatchResults,
  renderLookupNotice,
  parseBatchInput,
} from './ipinfo-tab';

type Tab = 'lookup' | 'batch';

const TAB_STORAGE_KEY = 'cb:ipinfo-tab';
const TAB_LABELS: Record<Tab, string> = {
  lookup: 'Lookup',
  batch: 'Batch',
};

export class IpInfoPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private currentIp = '';
  private currentResult: IpInfo | null = null;
  private currentThreat: IpThreatContext | null = null;
  private currentError: string | null = null;
  private looking = false;

  private batchInput = '';
  private batchInputs: string[] = [];
  private batchResults: (IpInfo | null)[] = [];
  private batchLoading = false;

  private history: HistoryEntry[] = loadHistoryFromStorage();

  constructor() {
    super({
      id: 'ipinfo-lookup',
      title: 'IP Info Lookup',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'ipinfo.io geolocation + ASN lookup. 1h per-IP cache. Last 20 lookups stored locally. Cross-references known bad-actor ASN list.',
    });
    this.render();
  }

  // ── Lookup actions ─────────────────────────────────────────────────

  private async runLookup(ip: string): Promise<void> {
    this.currentIp = ip.trim();
    this.currentError = null;
    if (!this.currentIp) {
      this.currentResult = null;
      this.currentThreat = null;
      this.render();
      return;
    }
    if (!isValidIp(this.currentIp)) {
      this.currentError = `"${this.currentIp}" doesn't look like a valid IPv4 or IPv6 address.`;
      this.currentResult = null;
      this.currentThreat = null;
      this.render();
      return;
    }
    this.looking = true;
    this.render();
    try {
      const info = await lookupIp(this.currentIp);
      if (!info) {
        this.currentError = 'ipinfo.io returned no data for this address.';
        this.currentResult = null;
        this.currentThreat = null;
        return;
      }
      this.currentResult = info;
      this.currentThreat = crossReferenceThreats(info);
      this.history = recordHistory(
        {
          ip: info.ip,
          countryCode: info.countryCode,
          city: info.city,
          asn: info.asn,
          at: Date.now(),
        },
        this.history,
      );
      saveHistoryToStorage(this.history);
    } finally {
      this.looking = false;
      this.render();
    }
  }

  private async runBatch(blob: string): Promise<void> {
    this.batchInput = blob;
    const inputs = parseBatchInput(blob);
    this.batchInputs = inputs;
    if (inputs.length === 0) {
      this.batchResults = [];
      this.render();
      return;
    }
    this.batchLoading = true;
    this.render();
    try {
      this.batchResults = await lookupIpBatch(inputs);
    } finally {
      this.batchLoading = false;
      this.render();
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    let body: string;
    switch (this.activeTab) {
      case 'lookup': { body = this.renderLookupTab(); break; }
      case 'batch':  { body = this.renderBatchTab(); break; }
    }
    this.setContent(`${this.renderTabStrip()}<div style="padding:0 2px;">${body}</div>`, () => this.wireHandlers());
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['lookup', 'batch'];
    return `<div class="ipinfo-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
        return `<button class="ipinfo-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${bg};color:inherit;border-radius:4px;cursor:pointer;font-size:12px;">${TAB_LABELS[tab]}</button>`;
      })
      .join('')}</div>`;
  }

  private renderLookupTab(): string {
    const form = renderSingleLookupForm(this.currentIp);
    let body = '';
    if (this.looking) {
      body = renderLookupNotice(`Looking up ${this.currentIp}…`);
    } else if (this.currentError) {
      body = renderLookupNotice(this.currentError, 'error');
    } else if (this.currentResult) {
      body = renderResultCard(this.currentResult, this.currentThreat);
    }
    return `<div>${form}${body}${renderHistory(this.history)}</div>`;
  }

  private renderBatchTab(): string {
    const form = renderBatchForm(this.batchInput);
    let body = '';
    if (this.batchLoading) {
      body = `<div class="panel-empty" style="padding:14px;">Looking up ${this.batchInputs.length} addresses…</div>`;
    } else if (this.batchResults.length > 0) {
      body = renderBatchResults(this.batchResults, this.batchInputs);
    }
    return `<div>${form}${body}</div>`;
  }

  // ── DOM wiring ─────────────────────────────────────────────────────

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.ipinfo-tab')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
      });
    }

    const form = root.querySelector<HTMLFormElement>('.ipinfo-form');
    const input = root.querySelector<HTMLInputElement>('.ipinfo-input');
    if (form && input) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void this.runLookup(input.value);
      });
    }

    for (const item of root.querySelectorAll<HTMLLIElement>('.ipinfo-history-item')) {
      item.addEventListener('click', () => {
        const ip = item.dataset.ip ?? '';
        if (!ip) return;
        void this.runLookup(ip);
      });
    }

    const batchForm = root.querySelector<HTMLFormElement>('.ipinfo-batch-form');
    const batchInput = root.querySelector<HTMLTextAreaElement>('.ipinfo-batch-input');
    if (batchForm && batchInput) {
      batchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void this.runBatch(batchInput.value);
      });
    }
  }
}

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'lookup' || stored === 'batch') return stored;
  } catch { /* noop */ }
  return 'lookup';
}
