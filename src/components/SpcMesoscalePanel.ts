import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { MesoscaleDiscussion } from '@/services/spc-mesoscale';

export class SpcMesoscalePanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'spc-mesoscale', title: 'SPC Mesoscale Discussions', showCount: true, trackActivity: false });
  }

  updateDiscussions(discussions: MesoscaleDiscussion[]): void {
 this.update(discussions.map(d => ({
 title: d.title,
 link: d.url,
 date: d.pubDate.toISOString(),
 summary: [d.mdType.toUpperCase(), d.affectedStates.join(', '), d.pds ? 'PDS' : null, d.watchIssued ? 'Watch Issued' : null].filter(Boolean).join(' · '),
 source: 'SPC',
 badge: d.pds ? 'PDS' : d.mdType.toUpperCase(),
 })));
  }
}
