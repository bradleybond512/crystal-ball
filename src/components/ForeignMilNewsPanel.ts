import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { ForeignMilNewsItem } from '@/services/foreign-mil-news';

export class ForeignMilNewsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'foreign-mil-news', title: 'Foreign Military News', showCount: true, trackActivity: false });
  }

  updateItems(items: ForeignMilNewsItem[]): void {
 this.update(items.map(i => ({
 title: i.title,
 link: i.url,
 date: i.pubDate.toISOString(),
 summary: i.description,
 source: i.source,
 badge: i.country,
 })));
  }
}
