import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { ArmsTransfer } from '@/services/dsca-arms-transfers';

export class DscaArmsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'dsca-arms-transfers', title: 'DSCA Arms Transfers', showCount: true, trackActivity: false });
  }

  updateTransfers(transfers: ArmsTransfer[]): void {
 this.update(transfers.map(t => ({
 title: t.title,
 link: t.url,
 date: t.pubDate.toISOString(),
 summary: [t.recipient, t.valueEstimate, t.systems.slice(0, 3).join(', ')].filter(Boolean).join(' · '),
 source: t.source === 'dsca' ? 'DSCA' : 'Fed Register',
 badge: t.category === 'major-defense' ? 'MAJOR DEFENSE' : t.category.toUpperCase(),
 })));
  }
}
