import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { BellingcatPost } from '@/services/bellingcat';

export class BellingcatPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'bellingcat-osint', title: 'Bellingcat OSINT', showCount: true, trackActivity: false });
  }

  updatePosts(posts: BellingcatPost[]): void {
 this.update(posts.map(p => ({
 title: p.title,
 link: p.link,
 date: p.pubDate,
 summary: p.description,
 source: 'Bellingcat',
 badge: 'OSINT',
 })));
  }
}
