/**
 * Crisis Signature Panel — surfaces matches from the
 * `CrisisSignatureLibrary` plus a catalog browser for the 8 built-in
 * signatures.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { renderPanelEmpty } from './ui/PanelStates';
import { formatDurationMinutes } from '@/utils/format-duration';
import {
  getCrisisSignatureLibrary,
  type CrisisSignature,
  type MatchConfidence,
  type SignatureMatch,
} from '@/services/intelligence/crisis-signature';
import {
  getLastConsolidationReport,
  runConsolidationNow,
  subscribeConsolidationReport,
} from '@/services/cognition/consolidation-state';
import { isCognitionEnabled, subscribeCognitionFlags } from '@/services/cognition/cognition-settings';

const CONFIDENCE_COLOR: Record<MatchConfidence, string> = {
  high: 'var(--severity-high,#f87171)',
  medium: 'var(--severity-medium,#facc15)',
  low: '#60a5fa',
};

const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const REFRESH_MS = 10_000;
const ACTIVE_MATCH_LIMIT = 10;

interface PanelState {
  expandedMatchId: string | null;
  expandedSignatureId: string | null;
  view: 'matches' | 'catalog';
}

export class CrisisSignaturePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubConsolidation: (() => void) | null = null;
  private unsubCognitionFlags: (() => void) | null = null;
  private consolidationRunning = false;
  private state: PanelState = { expandedMatchId: null, expandedSignatureId: null, view: 'matches' };

  constructor() {
    super({
      id: 'crisis-signature',
      title: 'Crisis Signature Library',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Fingerprints recurring crisis patterns. Matches incoming observation clusters against 8 historical signatures and ranks them by weighted feature score. The consolidation loop distills recurring episodes into new schemas every 6 hours.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsubscribe = getCrisisSignatureLibrary().subscribe(() => this.render());
    this.unsubConsolidation = subscribeConsolidationReport(() => {
      this.markFresh();
      this.render();
    });
    this.unsubCognitionFlags = subscribeCognitionFlags(() => this.render());
    this.attachHandlers();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubConsolidation?.();
    this.unsubConsolidation = null;
    this.unsubCognitionFlags?.();
    this.unsubCognitionFlags = null;
    super.destroy();
  }

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const library = getCrisisSignatureLibrary();
      const recent = library.getRecentMatches(ACTIVE_MATCH_LIMIT);
      const signatures = library.getAllSignatures();
      this.setCount(recent.length);
      this.setContent(this.buildHtml(recent, signatures));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Crisis signature render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    matches: readonly SignatureMatch[],
    signatures: readonly CrisisSignature[],
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderConsolidationStatus()}
      ${this.renderTabs()}
      ${this.state.view === 'matches' ? this.renderMatches(matches) : this.renderCatalog(signatures)}
    </div>`;
  }

  /**
   * Compact status block for the episodic→schema consolidation loop:
   * "Consolidation: N episodes → M schemas · last run <age> · X retired".
   * Reads the persisted report from the last cadence tick / manual run.
   */
  private renderConsolidationStatus(): string {
    const enabled = isCognitionEnabled('consolidation');
    const report = getLastConsolidationReport();
    let line: string;
    if (!enabled) {
      line = 'Consolidation: off — enable in Settings → General → Cognition';
    } else if (!report) {
      line = 'Consolidation: not run yet — runs every 6 h while the app is open';
    } else {
      const ageMin = Math.max(0, Math.round((Date.now() - report.ranAt) / 60_000));
      const age = ageMin < 1 ? 'just now' : `${formatDurationMinutes(ageMin)} ago`;
      line = `Consolidation: ${report.episodesProcessed} episodes → ${report.schemasRegistered} schemas · last run ${age} · ${report.schemasRetired} retired`;
    }
    const runLabel = this.consolidationRunning ? 'Running…' : 'Run now';
    const runBtn = enabled
      ? `<button class="cs-consolidate-now" ${this.consolidationRunning ? 'disabled' : ''} aria-label="Run consolidation now" style="margin-left:auto;padding:2px 10px;font-size:11px;border:1px solid var(--border-subtle,#333);background:transparent;color:var(--text-secondary,#aaa);border-radius:3px;cursor:pointer;flex-shrink:0;">${runLabel}</button>`
      : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(line)}</span>
      ${runBtn}
    </div>`;
  }

  private renderTabs(): string {
    const view = this.state.view;
    return `<div style="display:flex;gap:6px;">${renderTabButton('matches', 'Active matches', view)}${renderTabButton('catalog', 'Catalog', view)}</div>`;
  }

  private renderMatches(matches: readonly SignatureMatch[]): string {
    if (matches.length === 0) {
      return renderPanelEmpty({
        message: 'No active signature matches',
        hint: 'Matches appear when recent observations resemble a known crisis pattern',
      });
    }
    const rows = matches.map((m) => this.renderMatchRow(m)).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
  }

  private renderMatchRow(m: SignatureMatch): string {
    const expanded = this.state.expandedMatchId === m.signatureId;
    const color = CONFIDENCE_COLOR[m.confidence];
    const pct = Math.round(m.matchScore * 100);
    const when = new Date(m.detectedAt).toLocaleTimeString();
    const expandedBlock = expanded ? this.renderMatchExpansion(m) : '';
    return `<div class="cs-match" data-id="${escapeHtml(m.signatureId)}" style="padding:10px 12px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;">
        <strong style="font-size:13px;">${escapeHtml(m.signatureName)}</strong>
        <span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(m.signatureId)}</span>
        <span style="margin-left:auto;font-size:10px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(CONFIDENCE_LABEL[m.confidence])} · ${pct}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
        <span>${m.matchedFeatures.length} matched · ${m.missingFeatures.length} missing</span>
        <span>${escapeHtml(when)}</span>
      </div>
      <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:6px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
      ${expandedBlock}
    </div>`;
  }

  private renderMatchExpansion(m: SignatureMatch): string {
    const matched = m.matchedFeatures.length === 0
      ? '<em style="color:var(--text-secondary,#aaa);">none</em>'
      : m.matchedFeatures.map((f) => `<span style="padding:1px 6px;border-radius:3px;background:rgba(34,197,94,0.12);color:var(--severity-ok,#22c55e);font-size:10px;">${escapeHtml(f)}</span>`).join(' ');
    const missing = m.missingFeatures.length === 0
      ? '<em style="color:var(--text-secondary,#aaa);">none</em>'
      : m.missingFeatures.map((f) => `<span style="padding:1px 6px;border-radius:3px;background:rgba(248,113,113,0.12);color:var(--severity-high,#f87171);font-size:10px;">${escapeHtml(f)}</span>`).join(' ');
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);display:flex;flex-direction:column;gap:6px;font-size:11px;">
      <div><span style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-size:10px;margin-right:6px;">Matched</span>${matched}</div>
      <div><span style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-size:10px;margin-right:6px;">Missing</span>${missing}</div>
    </div>`;
  }

  private renderCatalog(signatures: readonly CrisisSignature[]): string {
    if (signatures.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No signatures loaded.</div>';
    }
    const rows = signatures.map((s) => this.renderCatalogRow(s)).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
  }

  private renderCatalogRow(s: CrisisSignature): string {
    const expanded = this.state.expandedSignatureId === s.id;
    const expandedBlock = expanded ? this.renderCatalogExpansion(s) : '';
    return `<div class="cs-sig" data-id="${escapeHtml(s.id)}" style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;">
        <strong style="font-size:13px;">${escapeHtml(s.name)}</strong>
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(96,165,250,0.12);color:#60a5fa;font-weight:700;text-transform:uppercase;">${escapeHtml(s.domain)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${s.patternFeatures.length} features · ${s.cascadeRisk.length} cascades</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(s.description)}</div>
      ${expandedBlock}
    </div>`;
  }

  private renderCatalogExpansion(s: CrisisSignature): string {
    const features = s.patternFeatures.map((f) => {
      const requiredBadge = f.required ? ' <span style="color:var(--severity-high,#f87171);font-weight:700;">[required]</span>' : '';
      return `<li>${escapeHtml(f.featureType)} (weight ${f.weight.toFixed(2)})${requiredBadge}</li>`;
    }).join('');
    const cascades = s.cascadeRisk.map((c) => `<li>→ ${escapeHtml(c.targetDomain)} · ${Math.round(c.probability * 100)}% · ~${c.delayHours}h</li>`).join('');
    const examples = s.historicalExamples.map((e) => `<span style="padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.04);font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(e)}</span>`).join(' ');
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);display:flex;flex-direction:column;gap:6px;font-size:11px;">
      <div>
        <div style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-size:10px;margin-bottom:2px;">Pattern features</div>
        <ul style="margin:0;padding-left:18px;">${features}</ul>
      </div>
      <div>
        <div style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-size:10px;margin-bottom:2px;">Cascade risk</div>
        <ul style="margin:0;padding-left:18px;">${cascades}</ul>
      </div>
      <div>
        <span style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-size:10px;margin-right:6px;">Historical examples</span>${examples}
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">avg duration ${s.avgDurationHours}h · peak ${escapeHtml(s.peakSeverity)} · threshold ${Math.round(s.confidenceThreshold * 100)}%</div>
    </div>`;
  }

  // ── Event handling ────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.cs-consolidate-now')) {
      if (this.consolidationRunning) return;
      this.consolidationRunning = true;
      this.render();
      void runConsolidationNow().finally(() => {
        this.consolidationRunning = false;
        // subscribeConsolidationReport re-renders on success; this covers
        // the disabled/failed path so the button doesn't stick on Running….
        this.render();
      });
      return;
    }
    const tab = target.closest<HTMLElement>('.cs-tab');
    if (tab) {
      const view = tab.dataset.tab;
      if (view === 'matches' || view === 'catalog') {
        this.state.view = view;
        this.render();
      }
      return;
    }
    const match = target.closest<HTMLElement>('.cs-match');
    if (match) {
      const id = match.dataset.id ?? null;
      this.state.expandedMatchId = this.state.expandedMatchId === id ? null : id;
      this.render();
      return;
    }
    const sig = target.closest<HTMLElement>('.cs-sig');
    if (sig) {
      const id = sig.dataset.id ?? null;
      this.state.expandedSignatureId = this.state.expandedSignatureId === id ? null : id;
      this.render();
    }
  }
}

function renderTabButton(
  id: 'matches' | 'catalog',
  label: string,
  activeView: 'matches' | 'catalog',
): string {
  const active = activeView === id;
  const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
  const color = active ? 'inherit' : 'var(--text-secondary,#aaa)';
  return `<button class="cs-tab" data-tab="${id}" style="padding:4px 12px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${bg};color:${color};border-radius:3px;cursor:pointer;">${escapeHtml(label)}</button>`;
}
