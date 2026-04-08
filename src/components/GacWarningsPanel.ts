import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { TravelWarning } from '@/services/travel-warnings';

export class GacWarningsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'gac-warnings', title: 'CA Travel Warnings', showCount: true, trackActivity: false });
  }

  updateWarnings(warnings: TravelWarning[]): void {
 this.update(warnings.map(w => ({
 title: w.title,
 link: w.link,
 date: w.date,
 summary: w.summary,
 source: w.source,
 badge: 'GAC',
 })));
  }
}
