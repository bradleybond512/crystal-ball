import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { AcapsCrisis } from '@/services/acaps';

export class AcapsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'acaps-crises', title: 'ACAPS Crisis Index', showCount: true, trackActivity: false });
  }

  updateCrises(crises: AcapsCrisis[]): void {
 this.update(crises.map(c => ({
 title: c.crisisName ?? c.country ?? 'Unknown Crisis',
 link: null,
 date: c.lastUpdated,
 summary: [c.category, c.severity ? `Severity: ${c.severity}` : null, c.peopleAffected ? `${c.peopleAffected.toLocaleString()} affected` : null].filter(Boolean).join(' · '),
 source: 'ACAPS',
 badge: c.countryCode ?? 'ACAPS',
 })));
  }
}
