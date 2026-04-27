import { Panel } from './Panel';
import { escapeHtml } from '@/utils';
import type { DodContract, DodContractsSnapshot } from '@/services/dod-contracts';
import { formatAmount } from '@/services/dod-contracts';

export class DodContractsPanel extends Panel {
  private snapshot: DodContractsSnapshot | null = null;

  constructor() {
 super({
 id: 'dod-contracts',
 title: 'DOD Contract Awards',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Top recent Department of Defense contract awards from USAspending.gov. Free, no key.',
 });
 this.showLoading('Fetching DOD contracts…');
  }

  update(snapshot: DodContractsSnapshot): void {
 this.snapshot = snapshot;
 this.setCount(snapshot.awards.length);
 this.render();
  }

  private render(): void {
 const snap = this.snapshot;
 if (!snap || snap.awards.length === 0) {
 this.setContent('<div class="panel-empty">No DOD contract awards in the period.</div>');
 return;
 }
 const totalLine = `<div class="dod-total">${formatAmount(snap.totalAmount)} total · ${snap.periodStart} → ${snap.periodEnd}</div>`;
 const rows = snap.awards.map((a) => this.renderRow(a)).join('');
 this.setContent(`${totalLine}<div class="dod-list">${rows}</div>`);
  }

  private renderRow(a: DodContract): string {
 const amount = formatAmount(a.amount);
 const recipient = escapeHtml(a.recipient || 'Unknown');
 const subAgency = a.subAgency ? `<span class="dod-sub">${escapeHtml(a.subAgency)}</span>` : '';
 const state = a.state ? `<span class="dod-state">${escapeHtml(a.state)}</span>` : '';
 const desc = a.description ? `<div class="dod-desc">${escapeHtml(a.description)}</div>` : '';
 return `<div class="dod-row">
 <div class="dod-row-head">
 <span class="dod-amount">${amount}</span>
 <span class="dod-recipient">${recipient}</span>
 ${state}
 </div>
 ${subAgency}
 ${desc}
 </div>`;
  }
}
