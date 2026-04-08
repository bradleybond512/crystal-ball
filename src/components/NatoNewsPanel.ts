import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { NatoNewsItem } from '@/services/nato-news';

export class NatoNewsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'nato-news', title: 'NATO Press', showCount: true, trackActivity: false });
  }

  updateNews(items: NatoNewsItem[]): void {
 this.update(items.map(i => ({
 title: i.title,
 link: i.link,
 date: i.pubDate,
 summary: i.description,
 source: i.source,
 badge: 'NATO',
 })));
  }
}
