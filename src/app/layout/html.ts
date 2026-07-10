/**
 * HTML builders extracted from panel-layout.ts.
 *
 * Pure(-ish) string templates — read the runtime context (AppContext), the
 * translation table, theme, mode, and variant flags and return a template
 * string. Behaviour should be 1:1 with the original methods; if you change
 * markup here, update the `app-shell-dom-contract` test that snapshots the
 * macOS sidebar and web-layout selectors.
 */
import type { AppContext } from '@/app/app-context';
import { SITE_VARIANT } from '@/config';
import { PANEL_CATEGORY_MAP } from '@/config/panels';
import { BETA_MODE } from '@/config/beta';
import { t } from '@/services/i18n';
import { getMode } from '@/services/mode-manager';
import { getCurrentTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import { icon } from '@/components/ui/icons';

function getMapLabel(): string {
  if (SITE_VARIANT === 'tech') return t('panels.techMap');
  if (SITE_VARIANT === 'happy') return 'Good News Map';
  return t('panels.map');
}

export function buildMapSection(): string {
  const mapLabel = getMapLabel();
  return `
 <div class="map-section" id="mapSection">
 <div class="panel-header">
 <div class="panel-header-left">
 <span class="panel-title">${mapLabel}</span>
 </div>
 <span class="header-clock" id="headerClock"></span>
 <button class="map-pin-btn" id="mapPinBtn" title="${t('header.pinMap')}">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
 <path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1v3.76z"/>
 </svg>
 </button>
 </div>
 <div class="map-container" id="mapContainer"></div>
 ${SITE_VARIANT === 'happy' ? '<button class="tv-exit-btn" id="tvExitBtn">Exit TV Mode</button>' : ''}
 <div class="map-resize-handle" id="mapResizeHandle"></div>
 </div>`;
}

export function buildThemeIcon(): string {
  return getCurrentTheme() === 'dark'
 ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
 : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
}

export function buildSidebarUpdateBtnHtml(ctx: AppContext): string {
  const versionLabel = escapeHtml(`v${__APP_VERSION__}${BETA_MODE ? ' β' : ''}`);
  const state = ctx.updateState;
  // While a check is in flight, render an inert label.
  if (state?.phase === 'checking') {
 return `<span class="mac-sidebar-version">${versionLabel}</span>`;
  }
  // A new release is out — primary action: install.
  if (state?.phase === 'available' && state.version) {
 const remoteLabel = escapeHtml(`v${state.version}`);
 return `<button class="mac-sidebar-update-btn" id="sidebarUpdateInstall" title="Install ${remoteLabel}">${versionLabel} → ${remoteLabel}</button>`;
  }
  // Auto-installer is downloading + replacing the .app bundle.
  if (state?.phase === 'installing') {
 return `<span class="mac-sidebar-version mac-sidebar-version--installing">Installing…</span>`;
  }
  // Up-to-date OR initial pre-check OR a previous fetch failed (state === null).
  // All three render the same clickable widget so the user can always trigger
  // a manual re-check; the ✓ only renders when we know the result is fresh.
  const okMark = state?.phase === 'up-to-date' ? ' ✓' : '';
  const okClass = state?.phase === 'up-to-date' ? ' mac-sidebar-version--ok' : '';
  const titleAttr = state?.phase === 'up-to-date'
 ? 'Click to check for updates'
 : 'Check for updates';
  return `<button class="mac-sidebar-version mac-sidebar-update-recheck${okClass}" id="sidebarUpdateRecheck" title="${titleAttr}">${versionLabel}${okMark}</button>`;
}

export function buildSidebarNav(ctx: AppContext): string {
  let html = '';
  for (const [, cat] of Object.entries(PANEL_CATEGORY_MAP)) {
 if (cat.variants && !cat.variants.includes(SITE_VARIANT)) continue;
 const keys = cat.panelKeys.filter(k => k !== 'map' && k in ctx.panelSettings);
 if (keys.length === 0) continue;
 html += `<div class="mac-sidebar-section"><span class="mac-sidebar-section-label">${t(cat.labelKey)}</span>`;
 for (const key of keys) {
 const cfg = ctx.panelSettings[key];
 if (!cfg) continue;
 const disabled = cfg.enabled ? '' : ' is-disabled';
 // title tooltip: labels ellipsize at the sidebar width, so always expose
 // the full name on hover (harmless when it fits, essential when it clips).
 html += `<button class="mac-sidebar-panel-item${disabled}" data-panel-key="${key}" title="${escapeHtml(cfg.name)}"><span class="mac-sidebar-panel-dot"></span>${cfg.name}</button>`;
 }
 html += `</div>`;
  }
  return html;
}

const TOOLBAR_TITLES: Record<string, string> = {
  tech: 'Tech Monitor',
  finance: 'Finance Monitor',
  happy: 'Good News',
};

export function buildDesktopLayout(ctx: AppContext): string {
  const toolbarTitle = TOOLBAR_TITLES[SITE_VARIANT] ?? 'Crystal Ball';
  const ghostActive = getMode() === 'ghost' ? ' mac-ghost-mode-active' : '';
  return String.raw`
 <!-- Original header kept for compatibility; hidden via CSS on desktop -->
 <div class="header" aria-hidden="true" style="display:none">
 <div class="header-left">
 <span class="logo">MONITOR</span><span class="version">v${__APP_VERSION__}</span>
 <div class="status-indicator"><span class="status-dot"></span><span>${t('header.live')}</span></div>
 <div class="region-selector" style="display:none"></div>
 </div>
 <div class="header-right">
 <button class="search-btn" id="searchBtn" style="display:none"><kbd>⌘K</kbd> ${t('header.search')}</button>
 <button class="theme-toggle-btn" id="headerThemeToggle" style="display:none" title="${t('header.toggleTheme')}">${buildThemeIcon()}</button>
 ${SITE_VARIANT === 'happy' ? '<button class="tv-mode-btn" id="tvModeBtn" style="display:none"></button>' : ''}
 <span style="display:none"></span>
 </div>
 </div>

 <!-- macOS native shell -->
 <div class="mac-shell app-root">

 <!-- Sidebar -->
 <aside class="mac-sidebar">
 <!-- Drag region / traffic-lights safe area — JS drag via _setupWindowDragRegions() -->
 <div class="mac-sidebar-drag" data-tauri-drag-region></div>

 <!-- Navigation: live panel list -->
 <nav class="mac-sidebar-nav">
 ${buildSidebarNav(ctx)}
 ${SITE_VARIANT === 'happy' ? `
 <div class="mac-sidebar-section">
 <button class="mac-sidebar-panel-item" id="tvModeBtn">
 <span class="mac-sidebar-panel-dot" style="background:var(--mac-orange)"></span>TV Mode
 </button>
 </div>` : ''}
 </nav>

 <!-- Mode Selector: Ghost + God's Vision only -->
 ${SITE_VARIANT === 'happy' ? '' : `<div class="mac-mode-section" id="modeSelectorSection">
 <button class="mac-alert-family-btn" id="alertFamilyBtn">${icon('alert-triangle', { size: 14 })} Alert Family</button>
 <button class="mac-ghost-mode-btn${ghostActive}" id="ghostModeBtn" title="Ghost Mode — Reduce polling, suppress notifications (⌘⇧G)">${icon('ghost', { size: 14 })} Ghost Mode</button>
 <button class="mac-ghost-mode-btn" id="godsVisionBtn" title="God's Vision — 3D globe view (G)">${icon('globe', { size: 14 })} God's Vision</button>
 <button class="mac-ghost-mode-btn" id="savedPlacesFilterBtn" title="Filter all panels by saved place proximity">${icon('pin', { size: 14 })} Proximity: OFF</button>
 </div>
 <div class="mac-situational-mode-section" id="situationalModeSwitcherSection">
 <div class="mac-situational-mode-label">
 <span>Mode</span>
 <span class="mac-situational-mode-auto" id="situationalModeAutoIndicator" title="System is auto-selecting mode based on active alerts">Auto</span>
 </div>
 <div class="mac-situational-mode-btns">
 <button class="mac-situational-mode-btn" data-mode-key="monitoring" title="Monitoring — normal operations, all panels visible">${icon('antenna', { size: 14 })} Monitor</button>
 <button class="mac-situational-mode-btn" data-mode-key="alert" title="Alert — active threats, red accents, critical items pinned">${icon('alert-triangle', { size: 14 })} Alert</button>
 <button class="mac-situational-mode-btn" data-mode-key="investigation" title="Investigation — focus evidence chain, de-emphasise noise">${icon('magnifier', { size: 14 })} Investigate</button>
 <button class="mac-situational-mode-btn" data-mode-key="briefing" title="Briefing — quiet palette, intel feeds emphasised">${icon('clipboard', { size: 14 })} Brief</button>
 </div>
 </div>`}

 <!-- Footer: theme, low-power, settings, version, collapse -->
 <div class="mac-sidebar-footer">
 <button class="mac-sidebar-footer-btn theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
 ${buildThemeIcon()}
 </button>
 <button class="mac-sidebar-footer-btn" id="lowPowerBtn" title="Low Power Mode — disable animations + spatial audio and quarter feed-poll frequency (Silent preset or on-battery halve it)">⚡</button>
 <span id="unifiedSettingsMount"></span>
 <span id="sidebarUpdateBtn">${buildSidebarUpdateBtnHtml(ctx)}</span>
 </div>
 </aside>

 <!-- Main content: toolbar + map/panels -->
 <main class="mac-content">
 <!-- Draggable toolbar (title bar area) — drag via JS _setupToolbarDrag() -->
 <div class="mac-content-toolbar app-titlebar" data-tauri-drag-region>
 <button class="mac-sidebar-toggle-btn" id="sidebarCollapseBtn" title="Toggle sidebar (⌘\)" aria-label="Toggle sidebar">
 <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
 <rect x="0" y="0" width="4" height="12" rx="1.5" fill="currentColor" opacity="0.5"/>
 <rect x="6" y="0" width="8" height="2" rx="1" fill="currentColor"/>
 <rect x="6" y="5" width="8" height="2" rx="1" fill="currentColor"/>
 <rect x="6" y="10" width="8" height="2" rx="1" fill="currentColor"/>
 </svg>
 </button>
 <span class="mac-toolbar-title" data-tauri-drag-region>
 ${toolbarTitle}<span class="mac-toolbar-version">v${__APP_VERSION__}${BETA_MODE ? ' β' : ''}</span>
 </span>
 <div class="mac-toolbar-status">
 <span class="status-dot"></span>
 <span>${t('header.live')}</span>
 </div>
 <div class="mac-toolbar-spacer" data-tauri-drag-region></div>
 <div class="region-selector">
 <select id="regionSelect" class="region-select">
 <option value="global">${t('components.deckgl.views.global')}</option>
 <option value="america">${t('components.deckgl.views.americas')}</option>
 <option value="mena">${t('components.deckgl.views.mena')}</option>
 <option value="eu">${t('components.deckgl.views.europe')}</option>
 <option value="asia">${t('components.deckgl.views.asia')}</option>
 <option value="latam">${t('components.deckgl.views.latam')}</option>
 <option value="africa">${t('components.deckgl.views.africa')}</option>
 <option value="oceania">${t('components.deckgl.views.oceania')}</option>
 </select>
 </div>
 <!-- Toolbar overflow — only visible when sidebar is collapsed -->
 <div class="mac-toolbar-sidebar-overflow" id="toolbarSidebarOverflow">
 <button class="mac-toolbar-overflow-btn" id="toolbarSettingsBtn" title="Settings (⌘,)">⚙</button>
 <button class="mac-toolbar-overflow-btn" id="toolbarThemeBtn" title="Toggle theme">☀</button>
 <button class="mac-toolbar-overflow-btn" id="toolbarModeBtn" title="Cycle mode (⌘M)">🕊</button>
 <button class="mac-toolbar-overflow-btn" id="toolbarBriefBtn" title="Export intelligence brief PDF">${icon('doc', { size: 14, label: 'Export intelligence brief PDF' })}</button>
 <button class="mac-toolbar-overflow-btn" id="toolbarAiBriefBtn" title="AI Situation Brief">${icon('brain', { size: 14, label: 'AI Situation Brief' })}</button>
 </div>
 <span class="header-clock" id="headerClock" data-tauri-drag-region></span>
 <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> ${t('header.search')}</button>
 </div>

 <!-- Map + panels -->
 <div class="mac-content-body">
 <div class="main-content">
 ${buildMapSection()}
 <div class="panels-grid" id="panelsGrid"></div>
 </div>
 </div>
 </main>

 </div>
 `;
}

export function buildWebLayout(ctx: AppContext): string {
  return `
 <div class="header">
 <div class="header-left">
 <span class="logo">MONITOR</span><span class="version">v${__APP_VERSION__}</span>${BETA_MODE ? '<span class="beta-badge">BETA</span>' : ''}
 <a href="https://github.com/bradleybond512/crystal-ball" target="_blank" rel="noopener" class="github-link" title="${t('header.viewOnGitHub')}">
 <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
 </a>
 <div class="status-indicator">
 <span class="status-dot"></span>
 <span>${t('header.live')}</span>
 </div>
 <div class="region-selector">
 <select id="regionSelect" class="region-select">
 <option value="global">${t('components.deckgl.views.global')}</option>
 <option value="america">${t('components.deckgl.views.americas')}</option>
 <option value="mena">${t('components.deckgl.views.mena')}</option>
 <option value="eu">${t('components.deckgl.views.europe')}</option>
 <option value="asia">${t('components.deckgl.views.asia')}</option>
 <option value="latam">${t('components.deckgl.views.latam')}</option>
 <option value="africa">${t('components.deckgl.views.africa')}</option>
 <option value="oceania">${t('components.deckgl.views.oceania')}</option>
 </select>
 </div>
 </div>
 <div class="header-right">
 ${ctx.isDesktopApp ? '' : `<div class="download-wrapper" id="downloadWrapper">
 <button class="download-btn" id="downloadBtn" title="${t('header.downloadApp')}">
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
 <span id="downloadBtnLabel">${t('header.downloadApp')}</span>
 </button>
 <div class="download-dropdown" id="downloadDropdown"></div>
 </div>`}
 <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> ${t('header.search')}</button>
 ${ctx.isDesktopApp ? '' : `<button class="copy-link-btn" id="copyLinkBtn">${t('header.copyLink')}</button>`}
 <button class="copy-link-btn" id="godsVisionBtn" title="God's Vision — 3D globe view (G)" style="display:inline-flex;align-items:center;gap:6px;">
 ${icon('globe', { size: 14 })} <span style="font-size:11px;">God's Vision</span>
 </button>
 <button class="copy-link-btn" id="webBriefBtn" title="Export intelligence brief PDF" style="display:inline-flex;align-items:center;gap:6px;">
 ${icon('doc', { size: 14 })} <span style="font-size:11px;">Export Brief</span>
 </button>
 <button class="copy-link-btn" id="webAiBriefBtn" title="AI Situation Brief" style="display:inline-flex;align-items:center;gap:6px;">
 ${icon('brain', { size: 14 })} <span style="font-size:11px;">AI Brief</span>
 </button>
 <button class="theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
 ${buildThemeIcon()}
 </button>
 ${ctx.isDesktopApp ? '' : `<button class="fullscreen-btn" id="fullscreenBtn" title="${t('header.fullscreen')}">⛶</button>`}
 ${SITE_VARIANT === 'happy' ? `<button class="tv-mode-btn" id="tvModeBtn" title="TV Mode (Shift+T)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></button>` : ''}
 <span id="unifiedSettingsMount"></span>
 </div>
 </div>
 <div class="main-content">
 ${buildMapSection()}
 <div class="panels-grid" id="panelsGrid"></div>
 </div>
 `;
}
