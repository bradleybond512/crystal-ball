import { animateIn, prefersReducedMotion } from '@/services/motion';
import { locationService } from '@/services/location';
import { OPTIONAL_ONBOARDING_SOURCES } from '@/services/home-shell/onboarding-sources';

const ONBOARDING_KEY = 'cb:onboarding-complete';
const WELCOME_BACKDROP_Z_INDEX = 100_000;
const WELCOME_TITLE_ID = 'cb-welcome-title';

const INTERESTS = [
  'Geopolitical',
  'Weather',
  'Cyber',
  'Markets',
  'Infrastructure',
  'Military',
  'Health',
  'Space',
] as const;

export const WELCOME_SOURCE_GROUPS = [
  {
    access: 'no-auth',
    heading: 'No configured credentials required',
    description: 'These public-source adapters use no authentication in repository wiring.',
    badge: 'no credential',
    sources: [
      { name: 'USGS Earthquakes', unlocks: 'Earthquake coverage' },
      { name: 'GDACS Disasters', unlocks: 'Global disaster alerts' },
      { name: 'Open-Meteo Weather', unlocks: 'Forecast coverage' },
      { name: 'GDELT News', unlocks: 'Global event coverage' },
    ],
  },
  {
    access: 'optional-credential',
    heading: 'Optional service credentials',
    description: 'These adapters require configured provider credentials; free tiers may be available.',
    badge: 'credential',
    sources: OPTIONAL_ONBOARDING_SOURCES,
  },
] as const;

export interface WelcomeFlowOptions {
  onLocationSet?: (lat: number, lng: number) => void;
  onInterestsSet?: (interests: string[]) => void;
  onComplete?: () => void;
}

export class WelcomeFlow {
  private backdrop: HTMLElement;
  private modal: HTMLElement;
  private stepEl: HTMLElement;
  private dotsEl: HTMLElement;
  private step = 0;
  private selectedInterests = new Set<string>(['Geopolitical', 'Weather']);
  private options: WelcomeFlowOptions;
  private restoreFocus: HTMLElement | null = null;
  private completed = false;
  private readonly backdropKeydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);

  constructor(options: WelcomeFlowOptions = {}) {
    this.options = options;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cb-backdrop';
    Object.assign(this.backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(WELCOME_BACKDROP_Z_INDEX),
      pointerEvents: 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    this.modal = document.createElement('div');
    this.modal.className = 'cb-modal-content';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', WELCOME_TITLE_ID);
    Object.assign(this.modal.style, {
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      background: 'rgba(18, 18, 22, 0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-8)',
      boxShadow: '0 32px 64px rgba(0, 0, 0, 0.6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-6)',
    });

    this.dotsEl = document.createElement('div');
    Object.assign(this.dotsEl.style, {
      display: 'flex',
      justifyContent: 'center',
      gap: 'var(--space-2)',
    });

    this.stepEl = document.createElement('div');

    this.modal.append(this.dotsEl);
    this.modal.append(this.stepEl);
    this.backdrop.append(this.modal);
    this.backdrop.addEventListener('keydown', this.backdropKeydownHandler);
  }

  static shouldShow(): boolean {
    return localStorage.getItem(ONBOARDING_KEY) !== 'true';
  }

  show(): void {
    this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.append(this.backdrop);
    this.renderDots();
    this.renderStep();
    this.focusFirstControl();
    void animateIn(this.modal, 'scale');
  }

  private close(): void {
    this.backdrop.removeEventListener('keydown', this.backdropKeydownHandler);
    this.modal.classList.add('closing');
    this.backdrop.classList.add('closing');

    this.backdrop.addEventListener('animationend', () => this.backdrop.remove(), { once: true });
    // Fallback if reduced-motion or animation doesn't fire
    setTimeout(() => this.backdrop.remove(), 500);
    this.restoreFocus?.focus();
    this.restoreFocus = null;
  }

  private focusableControls(): HTMLElement[] {
    return [...this.modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  }

  private focusFirstControl(): void {
    this.focusableControls()[0]?.focus();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.complete();
      return;
    }
    if (event.key !== 'Tab') return;

    const controls = this.focusableControls();
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  private renderDots(): void {
    this.dotsEl.textContent = '';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: i === this.step ? 'var(--accent)' : 'rgba(255, 255, 255, 0.2)',
        transition: 'background 0.2s ease',
      });
      this.dotsEl.append(dot);
    }
  }

  private renderStep(): void {
    this.stepEl.textContent = '';
    switch (this.step) {
      case 0: { this.renderLocation(); break;
      }
      case 1: { this.renderInterests(); break;
      }
      case 2: { this.renderApiKeys(); break;
      }
    }
    const title = this.stepEl.querySelector('h2');
    if (title) title.id = WELCOME_TITLE_ID;
    if (this.backdrop.isConnected) this.focusFirstControl();
  }

  private renderLocation(): void {
    const title = document.createElement('h2');
    title.textContent = 'Set Your Location';
    Object.assign(title.style, {
      margin: '0',
      fontSize: 'var(--text-xl)',
      fontWeight: 'var(--fw-semibold)',
      fontFamily: 'var(--font-ui)',
      color: '#f0f0f0',
    });

    const desc = document.createElement('p');
    desc.textContent = 'Crystal Ball tailors alerts to your region.';
    Object.assign(desc.style, {
      margin: '0',
      fontSize: 'var(--text-sm)',
      color: '#888',
      fontFamily: 'var(--font-ui)',
    });

    const gpsBtn = document.createElement('button');
    gpsBtn.className = 'cb-button accent';
    gpsBtn.textContent = 'Use My Location';
    gpsBtn.style.width = '100%';
    gpsBtn.style.padding = 'var(--space-3) var(--space-4)';
    gpsBtn.addEventListener('click', () => this.requestLocation(gpsBtn));

    const skipLink = document.createElement('button');
    skipLink.textContent = 'Skip for now';
    Object.assign(skipLink.style, {
      background: 'none',
      border: 'none',
      color: '#666',
      fontSize: 'var(--text-sm)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      textAlign: 'center',
      width: '100%',
      padding: 'var(--space-1)',
    });
    skipLink.addEventListener('click', () => this.advance());

    this.stepEl.append(title, desc, gpsBtn, skipLink);
  }

  private requestLocation(btn: HTMLButtonElement): void {
    const originalText = btn.textContent;
    btn.textContent = 'Locating...';
    btn.disabled = true;

    void locationService.getLocation({ timeoutMs: 8000 })
      .then((fix) => {
        if (this.completed) return;
        this.options.onLocationSet?.(fix.lat, fix.lon);
        this.advance();
      })
      .catch(() => {
        if (this.completed) return;
        btn.textContent = originalText;
        btn.disabled = false;
      });
  }

  private renderInterests(): void {
    const title = document.createElement('h2');
    title.textContent = 'What interests you?';
    Object.assign(title.style, {
      margin: '0',
      fontSize: 'var(--text-xl)',
      fontWeight: 'var(--fw-semibold)',
      fontFamily: 'var(--font-ui)',
      color: '#f0f0f0',
    });

    const pillWrap = document.createElement('div');
    Object.assign(pillWrap.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-2)',
    });

    for (const interest of INTERESTS) {
      const pill = document.createElement('button');
      pill.textContent = interest;
      const active = this.selectedInterests.has(interest);
      Object.assign(pill.style, {
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--fw-medium)',
        fontFamily: 'var(--font-ui)',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}`,
        background: active ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.04)',
        color: active ? '#93c5fd' : '#888',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      });
      pill.addEventListener('click', () => {
        if (this.selectedInterests.has(interest)) {
          this.selectedInterests.delete(interest);
          pill.style.border = '1px solid rgba(255,255,255,0.12)';
          pill.style.background = 'rgba(255,255,255,0.04)';
          pill.style.color = '#888';
        } else {
          this.selectedInterests.add(interest);
          pill.style.border = '1px solid var(--accent)';
          pill.style.background = 'rgba(59, 130, 246, 0.2)';
          pill.style.color = '#93c5fd';
        }
      });
      pillWrap.append(pill);
    }

    const continueBtn = document.createElement('button');
    continueBtn.className = 'cb-button accent';
    continueBtn.textContent = 'Continue';
    continueBtn.style.width = '100%';
    continueBtn.style.padding = 'var(--space-3) var(--space-4)';
    continueBtn.addEventListener('click', () => {
      this.options.onInterestsSet?.([...this.selectedInterests]);
      this.advance();
    });

    this.stepEl.append(title, pillWrap, continueBtn);
  }

  private renderApiKeys(): void {
    const title = document.createElement('h2');
    title.textContent = 'Connect your data sources';
    Object.assign(title.style, {
      margin: '0',
      fontSize: 'var(--text-xl)',
      fontWeight: 'var(--fw-semibold)',
      fontFamily: 'var(--font-ui)',
      color: '#f0f0f0',
    });

    const desc = document.createElement('p');
    desc.textContent = 'Authentication requirements shown here come from adapter wiring. Network access and upstream availability still apply.';
    Object.assign(desc.style, {
      margin: '0',
      fontSize: 'var(--text-sm)',
      color: '#888',
      fontFamily: 'var(--font-ui)',
    });

    const groups = document.createElement('div');
    Object.assign(groups.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    });

    for (const group of WELCOME_SOURCE_GROUPS) {
      const section = document.createElement('section');
      section.dataset.sourceAccess = group.access;
      const headingId = `welcome-sources-${group.access}`;
      section.setAttribute('aria-labelledby', headingId);

      const groupHeading = document.createElement('h3');
      groupHeading.id = headingId;
      groupHeading.textContent = group.heading;
      Object.assign(groupHeading.style, {
        margin: '0 0 2px',
        color: 'var(--text-primary)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-ui)',
      });

      const groupDescription = document.createElement('p');
      groupDescription.textContent = group.description;
      Object.assign(groupDescription.style, {
        margin: '0 0 var(--space-2)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-ui)',
      });

      const list = document.createElement('div');
      list.setAttribute('role', 'list');
      Object.assign(list.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
      });

      for (const source of group.sources) {
        const row = document.createElement('div');
        row.dataset.sourceName = source.name;
        row.setAttribute('role', 'listitem');
        Object.assign(row.style, {
          padding: 'var(--space-2) var(--space-3)',
          background: 'rgba(255,255,255,0.02)',
          fontFamily: 'var(--font-ui)',
        });

        const name = document.createElement('span');
        name.textContent = source.name;
        Object.assign(name.style, { fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginRight: 'var(--space-2)' });

        const badge = document.createElement('span');
        badge.textContent = group.badge;
        Object.assign(badge.style, {
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--fw-medium)',
          color: group.access === 'no-auth' ? 'var(--status-ok)' : 'var(--status-warn)',
          background: 'var(--mat-thin)',
          border: '1px solid var(--accent-selection)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px var(--space-2)',
        });

        const unlocks = document.createElement('span');
        unlocks.textContent = ` · ${source.unlocks}`;
        Object.assign(unlocks.style, { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' });
        row.append(name, badge, unlocks);
        list.append(row);
      }

      section.append(groupHeading, groupDescription, list);
      groups.append(section);
    }

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex',
      gap: 'var(--space-3)',
    });

    const skipBtn = document.createElement('button');
    skipBtn.className = 'cb-button';
    skipBtn.textContent = 'Skip for now';
    skipBtn.style.flex = '1';
    skipBtn.style.padding = 'var(--space-3) var(--space-4)';
    skipBtn.addEventListener('click', () => this.complete());

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'cb-button accent';
    settingsBtn.textContent = 'Open Settings';
    settingsBtn.style.flex = '1';
    settingsBtn.style.padding = 'var(--space-3) var(--space-4)';
    settingsBtn.addEventListener('click', () => {
      this.complete();
      document.dispatchEvent(new CustomEvent('wm:open-settings'));
    });

    btnRow.append(skipBtn, settingsBtn);
    this.stepEl.append(title, desc, groups, btnRow);
  }

  private advance(): void {
    if (prefersReducedMotion()) {
      this.step++;
      this.renderDots();
      this.renderStep();
      return;
    }

    this.stepEl.style.transition = 'transform 350ms var(--ease-out), opacity 350ms var(--ease-out)';
    this.stepEl.style.transform = 'translateX(-40px)';
    this.stepEl.style.opacity = '0';

    let advanced = false;
    const doAdvance = () => {
      if (advanced) return;
      advanced = true;
      this.step++;
      this.renderDots();
      this.renderStep();
      this.stepEl.style.transform = 'translateX(40px)';
      requestAnimationFrame(() => {
        this.stepEl.style.transform = 'translateX(0)';
        this.stepEl.style.opacity = '1';
      });
    };

    this.stepEl.addEventListener('transitionend', doAdvance, { once: true });
    // Fallback if transitionend doesn't fire
    setTimeout(doAdvance, 400);
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    localStorage.setItem(ONBOARDING_KEY, 'true');
    this.options.onComplete?.();
    this.close();
  }
}
