import { escapeHtml } from "@/utils/sanitize";
import { Panel } from './Panel';
import {
  buildRenderData,
  sortChokepointsByRisk,
  sortControlsByImpact,
  getCriticalChokepoints,
  riskClass,
} from './semiconductor-geopolitics-helpers';
import type {
  SemiconductorData,
  ChokepointNode,
  ExportControl,
} from './semiconductor-geopolitics-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SemiconductorGeopoliticsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private data: SemiconductorData;

  constructor() {
    super({
      id: 'semiconductor-geopolitics',
      title: 'Semiconductor Geopolitics',
      showCount: true,
      trackActivity: true,
    });
    this.data = buildRenderData();
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => {
        this.data = buildRenderData();
        this.render();
      }, REFRESH_MS);
    }
  }

  private render(): void {
    const d = this.data;
    const html = [
      renderHeader(d),
      renderChokepointsTable(sortChokepointsByRisk(d.chokepoints)),
      renderControlsTable(sortControlsByImpact(d.exportControls)),
    ].join('');
    this.setContent(
      `<div class="semiconductor-geopolitics-panel" style="padding:var(--space-3,12px);display:flex;flex-direction:column;gap:var(--space-4,16px);">${html}</div>`,
    );
    this.setCount(getCriticalChokepoints(d.chokepoints).length);
    this.markFresh();
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}

// ── Local HTML helpers ──────────────────────────────────────────────────────────

/** Numeric-friendly wrapper around the canonical escapeHtml() — this file
 *  interpolates both strings and numbers into templates. */
function safe(s: string | number): string {
  return escapeHtml(String(s));
}

function h(tag: string, attrs: Record<string, string>, inner = ''): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${safe(v)}"`)
    .join(' ');
  return `<${tag}${attrStr ? ' ' + attrStr : ''}>${inner}</${tag}>`;
}

// ── Color helpers ───────────────────────────────────────────────────────────────

function riskColor(risk: ChokepointNode['strategicRisk']): string {
  if (risk === 'critical') return '#ef4444';
  if (risk === 'high') return '#f97316';
  return '#eab308';
}

function impactColor(impact: ExportControl['impactLevel']): string {
  if (impact === 'severe') return '#ef4444';
  if (impact === 'significant') return '#f97316';
  return '#eab308';
}

function substituteColor(sub: ChokepointNode['substituteAvailability']): string {
  if (sub === 'none') return '#ef4444';
  if (sub === 'limited') return '#f97316';
  if (sub === 'developing') return '#eab308';
  return '#22c55e';
}

function riskIndexColor(idx: number): string {
  if (idx >= 70) return '#ef4444';
  if (idx >= 40) return '#f97316';
  if (idx >= 20) return '#eab308';
  return '#22c55e';
}

// ── Section renderers ───────────────────────────────────────────────────────────

function renderHeader(d: SemiconductorData): string {
  const criticalCount = getCriticalChokepoints(d.chokepoints).length;
  const controlRegimes = d.exportControls.length;
  const restrictedPowers = d.chipPowers.filter((p) => p.exportControlStatus === 'restricted').length;
  const idx = d.globalSupplyChainRiskIndex;
  const idxColor = riskIndexColor(idx);

  const stat = (value: string, label: string, color: string): string => `
    <div style="display:flex;flex-direction:column;gap:2px;min-width:80px;">
      <div style="font-size:var(--text-2xl,22px);font-weight:700;color:${safe(color)};">${value}</div>
      <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.06em;">${safe(label)}</div>
    </div>
  `;

  return `
    <div style="display:flex;gap:var(--space-4,16px);flex-wrap:wrap;align-items:flex-start;">
      ${stat(safe(idx), 'Supply Chain Risk', idxColor)}
      ${stat(safe(criticalCount), 'Critical Chokepoints', '#ef4444')}
      ${stat(safe(controlRegimes), 'Export Control Regimes', '#f97316')}
      ${stat(safe(restrictedPowers), 'Restricted Chip Powers', '#eab308')}
    </div>
    <div style="background:#1e1e1e;border-radius:2px;height:4px;overflow:hidden;">
      <div style="width:${safe(idx)}%;height:100%;background:${safe(idxColor)};transition:width .3s;"></div>
    </div>
  `;
}

function renderChokepointsTable(nodes: ChokepointNode[]): string {
  const rows = nodes
    .map((n) => {
      const color = riskColor(n.strategicRisk);
      const subColor = substituteColor(n.substituteAvailability);
      return `
        <tr class="${riskClass(n.strategicRisk)}" style="border-bottom:1px solid #2a2a2a;">
          <td style="padding:5px 6px;font-size:var(--text-sm,13px);color:#e5e5e5;font-weight:600;">
            ${safe(n.name)}
            <div style="font-size:10px;color:#888;font-weight:400;">${safe(n.type)}</div>
          </td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;">${safe(n.controlledBy)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:right;font-weight:700;">${safe(n.marketDominance)}%</td>
          <td style="padding:5px 6px;text-align:center;">
            <span style="font-size:10px;background:${safe(subColor)}22;color:${safe(subColor)};border-radius:4px;padding:1px 5px;">${safe(n.substituteAvailability)}</span>
          </td>
          <td style="padding:5px 6px;text-align:center;">
            <span style="font-size:10px;background:${safe(color)}22;color:${safe(color)};border-radius:4px;padding:1px 5px;font-weight:700;">${safe(n.strategicRisk.toUpperCase())}</span>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Supply Chain Chokepoints</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #444;">
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;' }, 'Node / Type')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;' }, 'Controlled By')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:right;font-weight:600;' }, 'Dominance')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;' }, 'Substitute')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;' }, 'Risk')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderControlsTable(controls: ExportControl[]): string {
  const rows = controls
    .map((c) => {
      const color = impactColor(c.impactLevel);
      return `
        <tr style="border-bottom:1px solid #2a2a2a;">
          <td style="padding:5px 6px;font-size:var(--text-sm,13px);color:#e5e5e5;font-weight:600;">
            ${safe(c.enforcedBy)}
            <div style="font-size:10px;color:#888;font-weight:400;">→ ${safe(c.targetCountry)}</div>
          </td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:center;">${safe(c.implementedYear)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#ccc;">${safe(c.keyRestrictions)}</td>
          <td style="padding:5px 6px;text-align:center;">
            <span style="font-size:10px;background:${safe(color)}22;color:${safe(color)};border-radius:4px;padding:1px 5px;font-weight:700;">${safe(c.impactLevel.toUpperCase())}</span>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Export Control Regimes</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #444;">
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;' }, 'Enforcer / Target')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;' }, 'Year')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;' }, 'Key Restriction')}
            ${h('th', { style: 'padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;' }, 'Impact')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
