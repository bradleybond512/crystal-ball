/**
 * Family Tracker Panel — LOCAL-FIRST location sharing for emergencies.
 *
 * No server, no cloud. Positions shared via compact "share codes"
 * designed for SMS or radio: WM:37.7749,-122.4194,SAFE,85%
 */

import { Panel } from '@/components/Panel';
import {
  getMembers,
  addMember,
  removeMember,
  updateStatus,
  shareMyLocation,
  generateShareCode,
  parseShareCode,
  subscribeFamilyTracker,
  distanceKm,
} from '@/services/family-tracker';
import type { FamilyMember, FamilyStatus } from '@/services/family-tracker';
import { safeSetItem } from '@/utils/safe-storage';

const ICON_OPTIONS = ['👨', '👩', '👧', '👦', '🐕', '👴', '👵', '🧑', '👶'];

const STATUS_LABELS: Record<FamilyStatus, string> = {
  safe: 'Safe',
  moving: 'Moving',
  stuck: 'Stuck',
  need_pickup: 'Need Pickup',
  need_meds: 'Need Meds',
  unknown: 'Unknown',
};

const STATUS_OPTIONS: FamilyStatus[] = ['safe', 'moving', 'stuck', 'need_pickup', 'need_meds'];

function ageColor(lastUpdate?: number): string {
  if (!lastUpdate) return '#888'; // gray — no data
  const ageMs = Date.now() - lastUpdate;
  const ageH = ageMs / 3_600_000;
  if (ageH < 1) return '#4caf50'; // green  < 1h
  if (ageH < 6) return '#ff9800'; // yellow 1-6h
  return '#ff453a'; // red > 6h
}

function timeAgo(ts?: number): string {
  if (!ts) return 'never';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export class FamilyTrackerPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private myLat: number | null = null;
  private myLon: number | null = null;
  private myStatus: FamilyStatus = 'safe';

  constructor() {
 super({
 id: 'family-tracker',
 title: '👨‍👩‍👧‍👦 Family Tracker',
 infoTooltip: 'Track family locations during emergencies. Share codes via SMS or radio — no internet needed for sharing. Format: WM:lat,lon,STATUS,BATT%',
 });
 this.render();
 this.unsubscribe = subscribeFamilyTracker(() => this.render());
  }

  destroy(): void {
 if (this.unsubscribe) {
 this.unsubscribe();
 this.unsubscribe = null;
 }
  }

  private render(): void {
 const members = getMembers();

 const myStatusOptions = STATUS_OPTIONS
 .map(s => `<option value="${s}"${s === this.myStatus ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`)
 .join('');

 const memberCards = members.map(m => this.renderMemberCard(m)).join('');

 const iconOptions = ICON_OPTIONS
 .map(ic => `<option value="${ic}">${ic}</option>`)
 .join('');

 this.content.innerHTML = `
 <div class="ftp-wrap">
 <div class="ftp-section">
 <div class="ftp-section-title">My Status</div>
 <div class="ftp-my-status">
 <select class="ftp-select" id="ftpMyStatus">${myStatusOptions}</select>
 <button class="ftp-btn ftp-btn-primary" id="ftpShareBtn">Share My Location</button>
 </div>
 <div class="ftp-share-result" id="ftpShareResult" style="display:none"></div>
 </div>

 <div class="ftp-section">
 <div class="ftp-section-title">Family Members (${members.length})</div>
 <div class="ftp-members" id="ftpMembers">
 ${memberCards || '<div class="ftp-empty">No family members added yet</div>'}
 </div>
 ${members.length > 0 ? '<button class="ftp-btn ftp-btn-map" id="ftpShowAll">Show All on Map</button>' : ''}
 </div>

 <div class="ftp-section">
 <div class="ftp-section-title">Add Member</div>
 <div class="ftp-add-form">
 <input class="ftp-input" id="ftpNewName" type="text" placeholder="Name" maxlength="30">
 <select class="ftp-select ftp-icon-select" id="ftpNewIcon">${iconOptions}</select>
 <button class="ftp-btn" id="ftpAddBtn">Add</button>
 </div>
 </div>

 <div class="ftp-section">
 <div class="ftp-section-title">Update Member Location</div>
 <div class="ftp-parse-form">
 <select class="ftp-select" id="ftpParseMember">
 ${members.map(m => `<option value="${m.id}">${m.icon} ${this.esc(m.name)}</option>`).join('')}
 </select>
 <input class="ftp-input" id="ftpParseCode" type="text" placeholder="WM:lat,lon,STATUS,BATT%">
 <button class="ftp-btn" id="ftpParseBtn">Parse</button>
 </div>
 <div class="ftp-parse-result" id="ftpParseResult" style="display:none"></div>
 </div>
 </div>
 `;

 this.bindEvents();
  }

  private renderMemberCard(m: FamilyMember): string {
 const color = ageColor(m.lastUpdate);
 const ago = timeAgo(m.lastUpdate);
 const statusLabel = STATUS_LABELS[m.status ?? 'unknown'];
 const loc = m.lastLocation
 ? `${m.lastLocation.lat.toFixed(4)}, ${m.lastLocation.lon.toFixed(4)}`
 : 'No location';

 let distStr = '';
 if (m.lastLocation && this.myLat != null && this.myLon != null) {
 const km = distanceKm(this.myLat, this.myLon, m.lastLocation.lat, m.lastLocation.lon);
 distStr = km < 1
 ? `${Math.round(km * 1000)}m away`
 : `${km.toFixed(1)}km away`;
 }

 const batteryStr = m.battery != null ? `${m.battery}%` : '';

 return `
 <div class="ftp-card" style="border-left: 3px solid ${color}">
 <div class="ftp-card-header">
 <span class="ftp-card-icon">${m.icon}</span>
 <span class="ftp-card-name">${this.esc(m.name)}</span>
 <span class="ftp-card-status ftp-status-${m.status ?? 'unknown'}">${statusLabel}</span>
 <button class="ftp-card-remove" data-remove-id="${m.id}" title="Remove member">&times;</button>
 </div>
 <div class="ftp-card-details">
 <span class="ftp-card-loc">${loc}</span>
 <span class="ftp-card-ago" style="color:${color}">${ago}</span>
 ${distStr ? `<span class="ftp-card-dist">${distStr}</span>` : ''}
 ${batteryStr ? `<span class="ftp-card-batt">🔋 ${batteryStr}</span>` : ''}
 </div>
 <div class="ftp-card-actions">
 <select class="ftp-select ftp-card-status-sel" data-status-id="${m.id}">
 ${STATUS_OPTIONS.map(s => `<option value="${s}"${s === m.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
 <option value="unknown"${m.status === 'unknown' ? ' selected' : ''}>Unknown</option>
 </select>
 </div>
 </div>
 `;
  }

  private bindEvents(): void {
 // My status selector
 const myStatusSel = this.content.querySelector('#ftpMyStatus') as HTMLSelectElement | null;
 myStatusSel?.addEventListener('change', () => {
 this.myStatus = myStatusSel.value as FamilyStatus;
 });

 // Share My Location
 const shareBtn = this.content.querySelector('#ftpShareBtn') as HTMLButtonElement | null;
 shareBtn?.addEventListener('click', () => void this.handleShare());

 // Add member
 const addBtn = this.content.querySelector('#ftpAddBtn') as HTMLButtonElement | null;
 addBtn?.addEventListener('click', () => this.handleAdd());

 // Parse share code
 const parseBtn = this.content.querySelector('#ftpParseBtn') as HTMLButtonElement | null;
 parseBtn?.addEventListener('click', () => this.handleParse());

 // Show all on map
 const showAllBtn = this.content.querySelector('#ftpShowAll') as HTMLButtonElement | null;
 showAllBtn?.addEventListener('click', () => this.handleShowAll());

 // Remove buttons
 for (const btn of this.content.querySelectorAll('.ftp-card-remove')) {
 btn.addEventListener('click', () => {
 const id = (btn as HTMLElement).dataset.removeId;
 if (id) removeMember(id);
 });
 }

 // Per-member status selectors
 for (const sel of this.content.querySelectorAll('.ftp-card-status-sel')) {
 sel.addEventListener('change', () => {
 const id = (sel as HTMLElement).dataset.statusId;
 if (id) updateStatus(id, (sel as HTMLSelectElement).value);
 });
 }
  }

  private async handleShare(): Promise<void> {
 const resultEl = this.content.querySelector('#ftpShareResult') as HTMLElement | null;
 if (!resultEl) return;

 try {
 resultEl.style.display = 'block';
 resultEl.textContent = 'Getting location...';
 resultEl.className = 'ftp-share-result';

 const loc = await shareMyLocation();
 this.myLat = loc.lat;
 this.myLon = loc.lon;

 const code = generateShareCode(loc.lat, loc.lon, this.myStatus);
 resultEl.textContent = code;
 resultEl.className = 'ftp-share-result ftp-share-success';

 try {
 await navigator.clipboard.writeText(code);
 resultEl.textContent = `${code}  (copied!)`;
 } catch {
 // Clipboard not available — code is still shown
 }

 // Re-render to update distances
 this.render();
 } catch (error) {
 resultEl.textContent = `Error: ${error instanceof Error ? error.message : 'Failed'}`;
 resultEl.className = 'ftp-share-result ftp-share-error';
 }
  }

  private handleAdd(): void {
 const nameInput = this.content.querySelector('#ftpNewName') as HTMLInputElement | null;
 const iconSelect = this.content.querySelector('#ftpNewIcon') as HTMLSelectElement | null;
 const name = nameInput?.value.trim();
 if (!name) return;
 const icon = iconSelect?.value ?? '🧑';
 addMember(name, icon);
 // render triggered by subscriber
  }

  private handleParse(): void {
 const memberSel = this.content.querySelector('#ftpParseMember') as HTMLSelectElement | null;
 const codeInput = this.content.querySelector('#ftpParseCode') as HTMLInputElement | null;
 const resultEl = this.content.querySelector('#ftpParseResult') as HTMLElement | null;

 if (!memberSel || !codeInput || !resultEl) return;

 const memberId = memberSel.value;
 const code = codeInput.value;
 const parsed = parseShareCode(code);

 if (!parsed) {
 resultEl.style.display = 'block';
 resultEl.textContent = 'Invalid share code. Expected: WM:lat,lon,STATUS,BATT%';
 resultEl.className = 'ftp-parse-result ftp-share-error';
 return;
 }

 // Apply to member
 const members = getMembers();
 const member = members.find(m => m.id === memberId);
 if (!member) return;

 // Use the service methods
 const { lat, lon, status, battery } = parsed;
 // We need to update the member directly in localStorage since we have multiple fields
 member.lastLocation = { lat, lon, accuracy: 0 };
 member.lastUpdate = Date.now();
 member.status = status;
 if (battery != null) member.battery = battery;
 safeSetItem('wm-family-members-v1', JSON.stringify(members));

 resultEl.style.display = 'block';
 resultEl.textContent = `Updated ${member.icon} ${member.name}: ${lat.toFixed(4)}, ${lon.toFixed(4)} — ${STATUS_LABELS[status]}${battery != null ? ` — ${battery}%` : ''}`;
 resultEl.className = 'ftp-parse-result ftp-share-success';

 // Trigger re-render
 this.render();
  }

  private handleShowAll(): void {
 const members = getMembers().filter(m => m.lastLocation);
 const positions = members.map(m => ({
 id: m.id,
 name: m.name,
 icon: m.icon,
 lat: m.lastLocation!.lat,
 lon: m.lastLocation!.lon,
 status: m.status ?? 'unknown',
 }));

 document.dispatchEvent(new CustomEvent('wm:show-family', { detail: { members: positions } }));
  }

  /** Minimal HTML escaping for user-provided names. */
  private esc(str: string): string {
 return str
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
  }
}
