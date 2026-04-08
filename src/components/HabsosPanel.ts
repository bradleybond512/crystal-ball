import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { HabObservation } from '@/services/habsos';

export class HabsosPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'habsos', title: 'Harmful Algal Blooms', showCount: true, trackActivity: false });
  }

  updateObservations(observations: HabObservation[]): void {
 this.update(observations.map(o => ({
 title: o.description,
 link: null,
 date: o.sampleDate.toISOString(),
 summary: [o.species, o.region, o.impacts.join(', ')].filter(Boolean).join(' · '),
 source: 'HABSOS',
 badge: o.state || o.region,
 })));
  }
}
