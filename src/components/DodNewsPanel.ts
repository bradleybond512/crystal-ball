import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { DodNewsItem } from '@/services/dod-news';

export class DodNewsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'dod-news', title: 'Pentagon News', showCount: true, trackActivity: false });
  }

  updateNews(items: DodNewsItem[]): void {
 this.update(items.map(i => ({
 title: i.title,
 link: i.link,
 date: i.pubDate,
 summary: i.description,
 source: i.source,
 badge: 'DoD',
 })));
  }
}
