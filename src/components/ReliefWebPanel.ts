import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { ReliefWebReport } from '@/services/reliefweb';

export class ReliefWebPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'reliefweb-crises', title: 'ReliefWeb Crises', showCount: true, trackActivity: false });
  }

  updateReports(reports: ReliefWebReport[]): void {
 this.update(reports.map(r => ({
 title: r.title,
 link: r.url,
 date: r.date,
 summary: r.summary,
 source: r.source ?? 'ReliefWeb',
 badge: r.country ?? 'ReliefWeb',
 })));
  }
}
