import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { IswReport } from '@/services/isw-reports';

export class IswReportsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'isw-reports', title: 'ISW Situation Reports', showCount: true, trackActivity: false });
  }

  updateReports(reports: IswReport[]): void {
 this.update(reports.map(r => ({
 title: r.title,
 link: r.link,
 date: r.pubDate,
 summary: r.description,
 source: 'ISW',
 })));
  }
}
