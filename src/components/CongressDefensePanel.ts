import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { CongressDefenseItem } from '@/services/congress-defense';

export class CongressDefensePanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'congress-defense', title: 'Congress Defense News', showCount: true, trackActivity: false });
  }

  updateItems(items: CongressDefenseItem[]): void {
 this.update(items.map(i => ({
 title: i.title,
 link: i.url,
 date: i.pubDate.toISOString(),
 summary: i.description,
 source: 'Congress',
 badge: i.chamber === 'Unknown' ? i.itemType.toUpperCase() : i.chamber.toUpperCase(),
 })));
  }
}
