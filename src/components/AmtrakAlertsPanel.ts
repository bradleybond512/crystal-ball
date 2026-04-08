import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { AmtrakAlert } from '@/services/amtrak-alerts';

export class AmtrakAlertsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'amtrak-alerts', title: 'Amtrak Service Alerts', showCount: true, trackActivity: false });
  }

  updateAlerts(alerts: AmtrakAlert[]): void {
 this.update(alerts.map(a => ({
 title: a.title,
 link: a.url,
 date: a.pubDate.toISOString(),
 summary: a.description,
 source: 'Amtrak',
 badge: a.corridor,
 })));
  }
}
