import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { EcdcAlert } from '@/services/ecdc-surveillance';

export class EcdcSurveillancePanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'ecdc-surveillance', title: 'ECDC Disease Surveillance', showCount: true, trackActivity: false });
  }

  updateAlerts(alerts: EcdcAlert[]): void {
 this.update(alerts.map(a => ({
 title: a.title,
 link: a.url,
 date: a.pubDate.toISOString(),
 summary: a.description,
 source: 'ECDC',
 badge: a.disease || a.reportType.toUpperCase(),
 })));
  }
}
