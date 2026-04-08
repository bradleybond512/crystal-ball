import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { UnScItem } from '@/services/un-security-council';

export class UnSecurityCouncilPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'un-security-council', title: 'UN Security Council', showCount: true, trackActivity: false });
  }

  updateItems(items: UnScItem[]): void {
 this.update(items.map(i => ({
 title: i.title,
 link: i.url,
 date: i.pubDate.toISOString(),
 summary: i.description,
 source: 'UN SC',
 badge: i.itemType.toUpperCase(),
 })));
  }
}
