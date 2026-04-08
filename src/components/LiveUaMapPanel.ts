import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { LiveUaEvent } from '@/services/liveuamap';

export class LiveUaMapPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'liveuamap', title: 'LiveUAMap Intel', showCount: true, trackActivity: false });
  }

  updateEvents(events: LiveUaEvent[]): void {
 this.update(events.map(e => ({
 title: e.title,
 link: e.link,
 date: e.pubDate,
 summary: e.description,
 source: e.source,
 badge: 'LiveUAMap',
 })));
  }
}
