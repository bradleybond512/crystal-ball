import { GenericIntelFeedPanel } from './GenericIntelFeedPanel';
import type { CommandRelease } from '@/services/combatant-commands';

export class CombatantCommandsPanel extends GenericIntelFeedPanel {
  constructor() {
 super({ id: 'combatant-commands', title: 'Combatant Commands', showCount: true, trackActivity: false });
  }

  updateReleases(releases: CommandRelease[]): void {
 this.update(releases.map(r => ({
 title: r.title,
 link: r.url,
 date: r.pubDate.toISOString(),
 summary: r.description,
 source: r.command,
 badge: r.command,
 })));
  }
}
