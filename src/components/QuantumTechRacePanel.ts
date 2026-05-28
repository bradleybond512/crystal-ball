import { Panel } from './Panel';
import {
  buildRenderData,
} from './quantum-tech-race-helpers';
import type { QuantumProgram, QuantumThreat } from './quantum-tech-race-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class QuantumTechRacePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private data: ReturnType<typeof buildRenderData>;

  constructor() {
    super({
      id: 'quantum-tech-race',
      title: 'Quantum Technology Race',
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

  private urgentThreatCount(): number {
    return this.data.threats.filter(
      (t) => t.urgency === 'immediate' || t.urgency === 'near-term',
    ).length;
  }

  private render(): void {
    const d = this.data;
    const html = [
      renderEncryptionThreatBanner(d.maxEncryptionThreat, d.leadingCountry),
      renderDominanceRankings(d.programs),
      renderUrgentThreats(d.threats),
    ].join('');
    this.setContent(
      `<div class="quantum-tech-race-panel" style="padding:var(--space-3,12px);display:flex;flex-direction:column;gap:var(--space-4,16px);">${html}</div>`,
    );
    this.setCount(this.urgentThreatCount());
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

// ── Section renderers ──────────────────────────────────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function threatColor(level: number): string {
  if (level >= 70) return '#ef4444';
  if (level >= 40) return '#f97316';
  if (level >= 20) return '#eab308';
  return '#22c55e';
}

function maturityColor(maturity: string): string {
  if (maturity === 'operational') return '#22c55e';
  if (maturity === 'advanced-prototype') return '#3b82f6';
  if (maturity === 'early-prototype') return '#a855f7';
  if (maturity === 'experimental') return '#f97316';
  return '#6b7280';
}

function urgencyColor(urgency: string): string {
  if (urgency === 'immediate') return '#ef4444';
  if (urgency === 'near-term') return '#f97316';
  if (urgency === 'medium-term') return '#eab308';
  return '#6b7280';
}

function domainLabel(domain: string): string {
  const labels: Record<string, string> = {
    computing: 'Computing',
    communications: 'Comms',
    sensing: 'Sensing',
    cryptography: 'Crypto',
  };
  return labels[domain] ?? domain;
}

function renderEncryptionThreatBanner(maxThreat: number, leadingCountry: string): string {
  const color = threatColor(maxThreat);
  const label =
    maxThreat >= 70 ? 'CRITICAL'
    : maxThreat >= 40 ? 'ELEVATED'
    : maxThreat >= 20 ? 'MODERATE'
    : 'LOW';
  return `
    <div style="display:flex;align-items:center;gap:var(--space-3,12px);flex-wrap:wrap;">
      <div style="background:${esc(color)};color:#fff;border-radius:6px;padding:4px 10px;font-weight:700;font-size:var(--text-sm,13px);letter-spacing:.02em;">
        ENCRYPTION THREAT: ${esc(label)}
      </div>
      <div style="font-size:var(--text-2xl,22px);font-weight:700;color:#e5e5e5;">${esc(maxThreat)}</div>
      <div style="font-size:var(--text-xs,11px);color:#888;">% toward RSA-2048 break</div>
      <div style="margin-left:auto;font-size:var(--text-xs,11px);color:#666;">Leader: <span style="color:#e5e5e5;font-weight:600;">${esc(leadingCountry)}</span></div>
    </div>
    <div style="background:#1e1e1e;border-radius:2px;height:4px;overflow:hidden;">
      <div style="width:${esc(maxThreat)}%;height:100%;background:${esc(color)};transition:width .3s;"></div>
    </div>
  `;
}

function renderDominanceRankings(programs: QuantumProgram[]): string {
  const rows = programs.map((p, idx) => {
    const color = maturityColor(p.maturity);
    const qubitStr = p.qubitCount != null ? `${p.qubitCount.toLocaleString()} qubits` : 'N/A';
    const invBn = (p.annualInvestmentUSD / 1e9).toFixed(1);
    const milBadge = p.militaryApplication
      ? `<span style="background:#ef444422;color:#ef4444;border-radius:4px;padding:1px 5px;font-size:10px;margin-left:4px;">MIL</span>`
      : '';
    return `
      <tr style="border-bottom:1px solid #2a2a2a;">
        <td style="padding:5px 6px;font-size:var(--text-sm,13px);color:#888;text-align:center;font-weight:600;">${esc(idx + 1)}</td>
        <td style="padding:5px 6px;font-size:var(--text-sm,13px);color:#e5e5e5;font-weight:600;">
          ${esc(p.country)}${milBadge}
          <div style="font-size:10px;color:#888;font-weight:400;">${esc(domainLabel(p.domain))}</div>
        </td>
        <td style="padding:5px 6px;text-align:center;">
          <span style="font-size:10px;background:${esc(color)}22;color:${esc(color)};border-radius:4px;padding:1px 5px;">${esc(p.maturity)}</span>
        </td>
        <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:right;">${esc(qubitStr)}</td>
        <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:right;">$${esc(invBn)}B</td>
        <td style="padding:5px 6px;font-size:var(--text-xs,11px);font-weight:700;color:${esc(color)};text-align:right;">${esc(p.dominanceScore)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Quantum Dominance Rankings</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #444;">
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">#</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;">Country / Domain</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">Maturity</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:right;font-weight:600;">Qubits</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:right;font-weight:600;">Investment</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:right;font-weight:600;">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderUrgentThreats(threats: QuantumThreat[]): string {
  const urgent = threats.filter(
    (t) => t.urgency === 'immediate' || t.urgency === 'near-term',
  );
  if (urgent.length === 0) {
    return `<div style="font-size:var(--text-xs,11px);color:#555;">No immediate or near-term threats identified.</div>`;
  }

  const items = urgent.map((t) => {
    const color = urgencyColor(t.urgency);
    const typeLabel = t.type.replace(/-/g, ' ').toUpperCase();
    const systems = t.affectedSystems.slice(0, 3).join(', ');
    return `
      <div style="padding:6px 0;border-bottom:1px solid #2a2a2a;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="background:${esc(color)}22;color:${esc(color)};border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;">${esc(t.urgency.toUpperCase())}</span>
          <span style="font-size:var(--text-xs,11px);color:#aaa;font-weight:600;">${esc(typeLabel)}</span>
          <span style="margin-left:auto;font-size:var(--text-xs,11px);color:#666;">${esc(t.actor)}</span>
        </div>
        <div style="font-size:var(--text-xs,11px);color:#ccc;margin-top:3px;">${esc(t.description)}</div>
        <div style="font-size:10px;color:#555;margin-top:2px;">Affects: ${esc(systems)}</div>
      </div>
    `;
  }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Urgent Threats (${esc(urgent.length)})</div>
      ${items}
    </div>
  `;
}
