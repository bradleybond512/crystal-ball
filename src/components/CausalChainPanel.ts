/**
 * CausalChainPanel — surfaces directed cause→effect chains built from
 * the CausalChainBuilder. Each chain shows root cause, depth, leaf
 * count, and overall confidence; click-to-expand reveals the ordered
 * links with mechanism, confidence, and delay hours.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCausalChainBuilder,
  type CausalChain,
  type CausalChainBuilder,
  type CausalLink,
} from '@/services/intelligence/causal-chain';

const REFRESH_MS = 30_000;

export class CausalChainPanel extends Panel {
  private readonly builder: CausalChainBuilder;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private expandedChainId: string | null = null;

  constructor() {
    super({
      id: 'causal-chain',
      title: 'Causal Chains',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Directed cause→effect chains assembled from correlated observations. Links carry mechanism, delay, and confidence from the domain-dependency graph.',
    });
    this.builder = getCausalChainBuilder();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.builder.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const chains = [...this.builder.getChains()].sort((a, b) => b.builtAt - a.builtAt);
      this.setCount(chains.length);
      this.setContent(this.buildHtml(chains), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Causal-chain panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(chains: readonly CausalChain[]): string {
    const header = `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Chains tracked</span>
      <span style="font-size:14px;font-weight:700;">${chains.length}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">most recent first</span>
    </div>`;
    if (chains.length === 0) {
      return `${header}<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
        No causal chains built yet. The builder populates as correlated observations stream in.
      </div>`;
    }
    const body = chains.map((c) => renderChain(c, c.id === this.expandedChainId)).join('');
    return `${header}<div style="max-height:480px;overflow:auto;">${body}</div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const card of root.querySelectorAll<HTMLElement>('.cc-card')) {
      card.addEventListener('click', () => {
        const id = card.dataset.chainId ?? null;
        this.expandedChainId = this.expandedChainId === id ? null : id;
        this.render();
      });
    }
  }
}

function renderChain(chain: CausalChain, expanded: boolean): string {
  const confPct = Math.round(chain.overallConfidence * 100);
  const confColor = confidenceColor(chain.overallConfidence);
  const linksHtml = expanded ? renderLinks(chain) : '';
  return `<div class="cc-card" data-chain-id="${escapeHtml(chain.id)}" style="padding:12px;border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(chain.rootCause.domain)}</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(chain.rootCause.title || chain.rootCause.id)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${chain.links.length} link${chain.links.length === 1 ? '' : 's'} · depth ${chain.longestPath} · ${chain.leafEffects.length} leaf${chain.leafEffects.length === 1 ? '' : 's'}</span>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${confPct}%;background:${confColor};"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:${confColor};min-width:42px;text-align:right;">${confPct}%</span>
    </div>
    <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">root <code>${escapeHtml(chain.rootCause.id)}</code>${chain.situationId ? ` · situation <code>${escapeHtml(chain.situationId)}</code>` : ''}</div>
    ${linksHtml}
  </div>`;
}

function renderLinks(chain: CausalChain): string {
  if (chain.links.length === 0) {
    return `<div style="margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.18);border-radius:4px;font-size:11px;color:var(--text-secondary,#aaa);">
      No downstream effects — root cause is a leaf.
    </div>`;
  }
  const rows = chain.links.map((link) => renderLink(link)).join('');
  return `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
}

function renderLink(link: CausalLink): string {
  const pct = Math.round(link.confidence * 100);
  const color = confidenceColor(link.confidence);
  return `<div style="padding:8px 10px;background:rgba(0,0,0,0.18);border-radius:4px;">
    <div style="display:flex;gap:6px;align-items:center;font-size:11px;font-family:ui-monospace,monospace;">
      <code>${escapeHtml(link.causeId)}</code>
      <span style="color:${color};font-weight:700;">→</span>
      <code>${escapeHtml(link.effectId)}</code>
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">~${link.delayHours}h · ${pct}%</span>
    </div>
    <div style="margin-top:4px;font-size:11px;color:var(--text-primary,#ddd);">${escapeHtml(link.mechanism)}</div>
  </div>`;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.75) return 'var(--severity-ok, #4ade80)';
  if (confidence >= 0.5) return 'var(--severity-medium, #facc15)';
  if (confidence >= 0.25) return 'var(--severity-high, #fb923c)';
  return 'var(--severity-critical, #ef4444)';
}
