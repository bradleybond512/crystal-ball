/* eslint-disable sonarjs/no-nested-conditional, unicorn/no-nested-ternary */
import { Panel } from './Panel';
import type { StrikePackage } from '@/services/strike-package';
import { summarizeStrikePackages } from '@/services/strike-package';
import { escapeHtml } from '@/utils/sanitize';

export class StrikePackagesPanel extends Panel {
  private readonly onStrikePackages = (e: Event): void => {
 const packages = (e as CustomEvent<StrikePackage[]>).detail ?? [];
 this.update(packages);
  };

  constructor() {
 super({
 id: 'strike-packages',
 title: 'Strike Packages',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Detected coordinated military aircraft formations classified by mission type (offensive strike, CAP, ISR, tanker bridge, etc.) with threat scoring.',
 });
 this.setContent('<div class="panel-empty">Awaiting military flight data\u2026</div>');

 // Listen for strike package updates from the data-loader
 document.addEventListener('wm:strike-packages', this.onStrikePackages);
  }

  public destroy(): void {
 super.destroy();
 document.removeEventListener('wm:strike-packages', this.onStrikePackages);
  }

  public update(packages: StrikePackage[]): void {
 if (packages.length === 0) {
 this.setContent('<div class="panel-empty">No coordinated formations detected.</div>');
 this.setCount(0);
 return;
 }

 const summary = summarizeStrikePackages(packages);
 this.setCount(packages.length);
 this.setContent(this.render(packages, summary));
  }

  private render(packages: StrikePackage[], summary: ReturnType<typeof summarizeStrikePackages>): string {
 // Summary header with pill badges
 const headerHtml = `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);">
 <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
 ${summary.critical > 0 ? `<span style="background:#ff453a;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">${summary.critical} CRITICAL</span>` : ''}
 ${summary.high > 0 ? `<span style="background:#ff9800;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">${summary.high} HIGH</span>` : ''}
 ${summary.inSensitiveAirspace > 0 ? `<span style="background:#8b0000;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">${summary.inSensitiveAirspace} SENSITIVE</span>` : ''}
 </div>
 <div style="font-size:10px;color:var(--text-muted,#888);">
 Offensive: ${summary.byType['offensive-strike']} \u2022 CAP: ${summary.byType['combat-air-patrol']} \u2022 ISR: ${summary.byType['isr-mission']} \u2022 Tanker: ${summary.byType['tanker-bridge']} \u2022 Logistics: ${summary.byType.humanitarian}
 </div>
 </div>`;

 // Package rows
 const rowsHtml = packages.slice(0, 15).map(pkg => {
 const threatColor = pkg.threatLevel === 'critical' ? '#ff453a' : pkg.threatLevel === 'high' ? '#ff9800' : pkg.threatLevel === 'elevated' ? '#ffeb3b' : '#4caf50';
 const rolesText = pkg.roles.slice(0, 4).map(r => `${r.count}\u00D7 ${escapeHtml(r.type)}`).join(' \u00B7 ');
 const sensitiveBadge = pkg.inSensitiveAirspace ? `<span style="background:rgba(255, 69, 58,0.2);color:#ff453a;padding:1px 5px;border-radius:3px;font-size:9px;margin-left:6px;">SENSITIVE</span>` : '';
 return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);">
 <div style="display:flex;justify-content:space-between;align-items:center;">
 <div>
 <span style="font-size:11px;font-weight:600;">${escapeHtml(pkg.label)}</span>
 ${sensitiveBadge}
 </div>
 <span style="font-size:13px;font-weight:700;color:${threatColor};">${pkg.threatScore}</span>
 </div>
 <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(pkg.description.slice(0, 180))}</div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:3px;">
 ${pkg.aircraftCount} aircraft \u00B7 ${rolesText} \u00B7 ${Math.round(pkg.meanAltitudeFt / 1000)}k ft \u00B7 ${pkg.operators.join('/')}
 </div>
 </div>`;
 }).join('');

 return headerHtml + rowsHtml;
  }
}
