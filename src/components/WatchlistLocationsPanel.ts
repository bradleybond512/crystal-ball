import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { watchlistLocations, type WatchedLocation } from '@/services/watchlist-locations';

const ICON_OPTIONS: readonly string[] = ['\u{1F3E0}', '\u{1F3E2}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u2708\uFE0F', '\u{1F4CD}', '\u2B50'];
const DEFAULT_ICON = '\u{1F3E0}';
const ICON_LABELS: Record<string, string> = {
  '\u{1F3E0}': 'Home',
  '\u{1F3E2}': 'Office',
  '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}': 'Family',
  '\u2708\uFE0F': 'Travel',
  '\u{1F4CD}': 'Pin',
  '\u2B50': 'Star',
};

export class WatchlistLocationsPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private editingId: string | null = null;
  private showAddForm = false;

  constructor() {
 super({
 id: 'watchlist-locations',
 title: 'Watched Locations',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Manage watched locations with per-location alert radii for proximity-based alerts.',
 });

 // Header add button
 const addBtn = document.createElement('button');
 addBtn.className = 'spm-header-add';
 addBtn.title = 'Add location';
 addBtn.type = 'button';
 addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
 addBtn.addEventListener('click', () => {
 this.showAddForm = !this.showAddForm;
 this.editingId = null;
 this.render();
 });
 this.header.append(addBtn);

 this.content.addEventListener('click', (e) => this.handleClick(e));
 this.content.addEventListener('change', (e) => this.handleChange(e));
 this.content.addEventListener('submit', (e) => this.handleSubmit(e));

 this.unsubscribe = watchlistLocations.subscribe(() => this.render());
 this.render();
  }

  override destroy(): void {
 this.unsubscribe?.();
 super.destroy();
  }

  private render(): void {
 const locations = watchlistLocations.getWatchedLocations();
 this.setCount(locations.length);

 const parts: string[] = [];

 // Add / Edit form
 if (this.showAddForm || this.editingId) {
 const editing = this.editingId
 ? locations.find(l => l.id === this.editingId) ?? null
 : null;
 parts.push(this.renderForm(editing));
 }

 // Location cards
 if (locations.length === 0 && !this.showAddForm) {
 parts.push(`<div class="wlp-empty">
 <p>No watched locations yet.</p>
 <button class="wlp-btn wlp-btn-primary" data-wlp-action="add">Add Location</button>
 <button class="wlp-btn wlp-btn-secondary" data-wlp-action="import">Import from Saved Places</button>
 </div>`);
 } else {
 for (const loc of locations) {
 parts.push(this.renderCard(loc));
 }
 if (!this.showAddForm && !this.editingId) {
 parts.push(`<div class="wlp-actions">
 <button class="wlp-btn wlp-btn-secondary wlp-btn-sm" data-wlp-action="import">Import from Saved Places</button>
 </div>`);
 }
 }

 this.content.innerHTML = parts.join('');
  }

  private renderCard(loc: WatchedLocation): string {
 const isEditing = this.editingId === loc.id;
 const enabledClass = loc.enabled ? 'wlp-card-enabled' : 'wlp-card-disabled';
 return `<div class="wlp-card ${enabledClass}" data-wlp-id="${escapeHtml(loc.id)}">
 <div class="wlp-card-main">
 <span class="wlp-card-icon">${escapeHtml(loc.icon)}</span>
 <div class="wlp-card-info">
 <div class="wlp-card-label">${escapeHtml(loc.label)}</div>
 <div class="wlp-card-coords">${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)} &middot; ${loc.radiusMi} mi radius</div>
 </div>
 <div class="wlp-card-controls">
 <label class="wlp-toggle" title="${loc.enabled ? 'Disable' : 'Enable'}">
 <input type="checkbox" data-wlp-toggle="${escapeHtml(loc.id)}" ${loc.enabled ? 'checked' : ''}>
 <span class="wlp-toggle-slider"></span>
 </label>
 <button class="wlp-btn-icon" data-wlp-edit="${escapeHtml(loc.id)}" title="Edit"${isEditing ? ' disabled' : ''}>
 <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
 </button>
 <button class="wlp-btn-icon wlp-btn-danger" data-wlp-delete="${escapeHtml(loc.id)}" title="Delete">
 <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
 </button>
 </div>
 </div>
 </div>`;
  }

  private renderForm(editing: WatchedLocation | null): string {
 const label = editing?.label ?? '';
 const lat = editing ? editing.lat.toString() : '';
 const lon = editing ? editing.lon.toString() : '';
 const radius = editing?.radiusMi ?? 100;
 const icon = editing?.icon ?? DEFAULT_ICON;
 const title = editing ? 'Edit Location' : 'Add Location';

 const iconPicker = ICON_OPTIONS.map(ic => {
 const selected = ic === icon ? ' wlp-icon-selected' : '';
 return `<button type="button" class="wlp-icon-btn${selected}" data-wlp-icon="${escapeHtml(ic)}" title="${escapeHtml(ICON_LABELS[ic] ?? '')}">${ic}</button>`;
 }).join('');

 return `<form class="wlp-form" data-wlp-form="${editing ? 'edit' : 'add'}" data-wlp-edit-id="${editing?.id ?? ''}">
 <div class="wlp-form-title">${title}</div>
 <div class="wlp-form-row">
 <label>Label</label>
 <input type="text" name="label" value="${escapeHtml(label)}" placeholder="Home, Office, Mom's house..." required maxlength="60">
 </div>
 <div class="wlp-form-row wlp-form-row-pair">
 <div>
 <label>Latitude</label>
 <input type="number" name="lat" value="${escapeHtml(lat)}" step="any" min="-90" max="90" placeholder="37.7749" required>
 </div>
 <div>
 <label>Longitude</label>
 <input type="number" name="lon" value="${escapeHtml(lon)}" step="any" min="-180" max="180" placeholder="-122.4194" required>
 </div>
 </div>
 <div class="wlp-form-row">
 <label>Alert Radius: <span class="wlp-radius-value">${radius}</span> mi</label>
 <input type="range" name="radiusMi" min="10" max="1000" step="10" value="${radius}" class="wlp-radius-slider">
 </div>
 <div class="wlp-form-row">
 <label>Icon</label>
 <div class="wlp-icon-picker">${iconPicker}</div>
 <input type="hidden" name="icon" value="${escapeHtml(icon)}">
 </div>
 <div class="wlp-form-buttons">
 <button type="submit" class="wlp-btn wlp-btn-primary wlp-btn-sm">${editing ? 'Save' : 'Add'}</button>
 <button type="button" class="wlp-btn wlp-btn-secondary wlp-btn-sm" data-wlp-action="cancel">Cancel</button>
 </div>
 </form>`;
  }

  private handleClick(e: Event): void {
 const target = e.target as HTMLElement;

 if (this.handleActionClick(target)) return;
 if (this.handleEditClick(e, target)) return;
 if (this.handleDeleteClick(e, target)) return;
 this.handleIconClick(e, target);
  }

  private handleActionClick(target: HTMLElement): boolean {
 const actionBtn = target.closest<HTMLElement>('[data-wlp-action]');
 if (!actionBtn) return false;
 const action = actionBtn.dataset.wlpAction;
 if (action === 'add') {
 this.showAddForm = true;
 this.editingId = null;
 } else if (action === 'cancel') {
 this.showAddForm = false;
 this.editingId = null;
 } else if (action === 'import') {
 watchlistLocations.importFromSavedPlaces();
 }
 this.render();
 return true;
  }

  private handleEditClick(e: Event, target: HTMLElement): boolean {
 const editBtn = target.closest<HTMLElement>('[data-wlp-edit]');
 if (!editBtn) return false;
 e.stopPropagation();
 this.editingId = editBtn.dataset.wlpEdit ?? null;
 this.showAddForm = false;
 this.render();
 return true;
  }

  private handleDeleteClick(e: Event, target: HTMLElement): boolean {
 const deleteBtn = target.closest<HTMLElement>('[data-wlp-delete]');
 if (!deleteBtn) return false;
 e.stopPropagation();
 const id = deleteBtn.dataset.wlpDelete;
 if (id) {
 watchlistLocations.removeLocation(id);
 if (this.editingId === id) this.editingId = null;
 }
 return true;
  }

  private handleIconClick(e: Event, target: HTMLElement): void {
 const iconBtn = target.closest<HTMLElement>('[data-wlp-icon]');
 if (!iconBtn) return;
 e.preventDefault();
 const form = iconBtn.closest('form');
 const hiddenInput = form?.querySelector<HTMLInputElement>('input[name="icon"]');
 if (hiddenInput && iconBtn.dataset.wlpIcon) {
 hiddenInput.value = iconBtn.dataset.wlpIcon;
 form?.querySelectorAll('.wlp-icon-btn').forEach(btn => btn.classList.remove('wlp-icon-selected'));
 iconBtn.classList.add('wlp-icon-selected');
 }
  }

  private handleChange(e: Event): void {
 const target = e.target as HTMLElement;

 // Toggle enable/disable
 const toggleInput = target.closest<HTMLInputElement>('[data-wlp-toggle]');
 if (toggleInput) {
 const id = toggleInput.dataset.wlpToggle;
 if (id) {
 watchlistLocations.updateLocation(id, { enabled: toggleInput.checked });
 }
 return;
 }

 // Radius slider live update
 if (target instanceof HTMLInputElement && target.name === 'radiusMi') {
 const label = target.closest('.wlp-form-row')?.querySelector('.wlp-radius-value');
 if (label) label.textContent = target.value;
 }
  }

  private handleSubmit(e: Event): void {
 e.preventDefault();
 const form = e.target as HTMLFormElement;
 if (!form.matches('[data-wlp-form]')) return;

 const formData = new FormData(form);
 const label = (formData.get('label') as string || '').trim();
 const lat = Number.parseFloat(formData.get('lat') as string);
 const lon = Number.parseFloat(formData.get('lon') as string);
 const radiusMi = Number.parseInt(formData.get('radiusMi') as string, 10);
 const icon = (formData.get('icon') as string) || DEFAULT_ICON;

 if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

 const isEdit = form.dataset.wlpForm === 'edit';
 const editId = form.dataset.wlpEditId;

 if (isEdit && editId) {
 watchlistLocations.updateLocation(editId, { label, lat, lon, radiusMi, icon });
 } else {
 watchlistLocations.addLocation({ label, lat, lon, radiusMi, enabled: true, icon });
 }

 this.showAddForm = false;
 this.editingId = null;
 this.render();
  }
}
