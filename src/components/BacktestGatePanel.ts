/**
 * BacktestGate Panel — operator view of the pre-apply safety gate.
 *
 * Vanilla TS, extends Panel. Subscribes to the gate for live verdict
 * updates; a 10 s timer is the safety net.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  CHANGE_TEMPLATES,
  getBacktestGate,
  type GateConfidenceLevel,
  type GateVerdict,
  type ProposedChange,
} from '@/services/intelligence/backtest-gate';

const CONFIDENCE_COLOR: Record<GateConfidenceLevel, string> = {
  high: 'var(--severity-ok,#22c55e)',
  medium: 'var(--severity-medium,#facc15)',
  low: 'var(--severity-high,#f87171)',
};

const CONFIDENCE_LABEL: Record<GateConfidenceLevel, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const REFRESH_MS = 10_000;
const RECENT_VERDICT_LIMIT = 15;

interface FormState {
  templateId: string;
  algoId: string;
  proposedValue: string;
  rationale: string;
}

export class BacktestGatePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private form: FormState = {
    templateId: CHANGE_TEMPLATES[0]?.id ?? '',
    algoId: 'driver-scorer',
    proposedValue: '0.1',
    rationale: '',
  };

  constructor() {
    super({
      id: 'backtest-gate',
      title: 'Backtest Gate',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Pre-apply safety gate. Every proposed algorithm parameter change is run through BacktestEngine before it can be applied. Approves only when simulated accuracy clears the 50% floor with no significant regression.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getBacktestGate().subscribe(() => this.render());
    this.attachHandlers();
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

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const gate = getBacktestGate();
      const pending = gate.getPending();
      // Newest first. (toReversed is ES2023; project targets ES2020.)
      const verdictsAsc = gate.getVerdicts();
      const verdicts: GateVerdict[] = [];
      for (let i = verdictsAsc.length - 1; i >= 0; i -= 1) verdicts.push(verdictsAsc[i]!);
      this.setCount(pending.length);
      this.setContent(this.buildHtml(pending, verdicts.slice(0, RECENT_VERDICT_LIMIT)));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Backtest gate render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    pending: readonly ProposedChange[],
    verdicts: readonly GateVerdict[],
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderForm()}
      ${this.renderPending(pending)}
      ${this.renderVerdicts(verdicts)}
    </div>`;
  }

  private renderForm(): string {
    const templateOptions = CHANGE_TEMPLATES.map((t) =>
      `<option value="${escapeHtml(t.id)}"${t.id === this.form.templateId ? ' selected' : ''}>${escapeHtml(t.label)}</option>`,
    ).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);">Propose a change</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <select class="bg-form" data-field="templateId" style="padding:4px 6px;background:rgba(0,0,0,0.25);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${templateOptions}</select>
        <input class="bg-form" data-field="algoId" type="text" value="${escapeHtml(this.form.algoId)}" placeholder="Algorithm id" style="padding:4px 6px;background:rgba(0,0,0,0.25);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;" />
        <input class="bg-form" data-field="proposedValue" type="text" value="${escapeHtml(this.form.proposedValue)}" placeholder="Proposed value (number)" style="padding:4px 6px;background:rgba(0,0,0,0.25);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;" />
        <input class="bg-form" data-field="rationale" type="text" value="${escapeHtml(this.form.rationale)}" placeholder="Rationale (optional)" style="padding:4px 6px;background:rgba(0,0,0,0.25);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;" />
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button class="bg-action" data-action="submit" style="padding:4px 10px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Submit</button>
        <button class="bg-action" data-action="evaluate" style="padding:4px 10px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Evaluate</button>
      </div>
    </div>`;
  }

  private renderPending(pending: readonly ProposedChange[]): string {
    if (pending.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No pending changes — all submissions have been evaluated.</div>';
    }
    const rows = pending.map((c) => `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <strong>${escapeHtml(c.algoId)}</strong>
        <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(c.paramName)}</span>
        <span style="margin-left:auto;color:#60a5fa;">${escapeHtml(formatValue(c.currentValue))} → ${escapeHtml(formatValue(c.proposedValue))}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(c.rationale)}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px;">
        <button class="bg-pending" data-id="${escapeHtml(c.id ?? '')}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Evaluate</button>
      </div>
    </div>`).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Pending</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
  }

  private renderVerdicts(verdicts: readonly GateVerdict[]): string {
    if (verdicts.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No verdicts recorded yet.</div>';
    }
    const rows = verdicts.map((v) => this.renderVerdictRow(v)).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Recent verdicts</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="color:var(--text-secondary,#aaa);text-align:left;">
            <th style="padding:4px 6px;font-weight:600;">Status</th>
            <th style="padding:4px 6px;font-weight:600;">Change</th>
            <th style="padding:4px 6px;font-weight:600;">Current → Sim</th>
            <th style="padding:4px 6px;font-weight:600;">Δ</th>
            <th style="padding:4px 6px;font-weight:600;">Confidence</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private renderVerdictRow(v: GateVerdict): string {
    const approvedColor = v.approved ? 'var(--severity-ok,#22c55e)' : 'var(--severity-high,#f87171)';
    const approvedLabel = v.approved ? 'APPROVED' : 'REJECTED';
    const deltaColor = v.delta >= 0 ? 'var(--severity-ok,#22c55e)' : 'var(--severity-high,#f87171)';
    const confColor = CONFIDENCE_COLOR[v.confidenceLevel];
    const confLabel = CONFIDENCE_LABEL[v.confidenceLevel];
    return `<tr style="border-top:1px solid var(--border-subtle,#222);">
      <td style="padding:4px 6px;color:${approvedColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(approvedLabel)}</td>
      <td style="padding:4px 6px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(v.changeId)}</td>
      <td style="padding:4px 6px;">${Math.round(v.currentAccuracy * 100)}% → ${Math.round(v.simulatedAccuracy * 100)}%</td>
      <td style="padding:4px 6px;color:${deltaColor};">${signedPct(v.delta)}</td>
      <td style="padding:4px 6px;color:${confColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(confLabel)}</td>
    </tr>`;
  }

  // ── Event handling ───────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('input', (e) => this.onInput(e));
    this.content.addEventListener('change', (e) => this.onInput(e));
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!target?.classList.contains('bg-form')) return;
    const field = target.dataset.field;
    if (!field) return;
    if (field === 'templateId') this.form.templateId = target.value;
    else if (field === 'algoId') this.form.algoId = target.value;
    else if (field === 'proposedValue') this.form.proposedValue = target.value;
    else if (field === 'rationale') this.form.rationale = target.value;
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionBtn = target.closest<HTMLElement>('.bg-action');
    if (actionBtn) {
      event.stopPropagation();
      this.handleAction(actionBtn.dataset.action ?? '');
      return;
    }
    const pendingBtn = target.closest<HTMLElement>('.bg-pending');
    if (pendingBtn) {
      event.stopPropagation();
      const id = pendingBtn.dataset.id;
      if (!id) return;
      const gate = getBacktestGate();
      const change = gate.getPending().find((c) => c.id === id);
      if (change) gate.evaluate(change);
      this.render();
    }
  }

  private handleAction(action: string): void {
    if (action !== 'submit' && action !== 'evaluate') return;
    const template = CHANGE_TEMPLATES.find((t) => t.id === this.form.templateId);
    if (!template) return;
    const proposedValue = Number.parseFloat(this.form.proposedValue);
    const change = template.build({
      algoId: this.form.algoId.trim() || 'driver-scorer',
      rationale: this.form.rationale.trim() || undefined,
      proposedValue: Number.isFinite(proposedValue) ? proposedValue : this.form.proposedValue,
    });
    const gate = getBacktestGate();
    if (action === 'submit') {
      gate.submitChange(change);
    } else {
      gate.evaluate(change);
    }
    this.render();
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[object]'; }
  }
  return '[unprintable]';
}

function signedPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}
