import { animateIn, prefersReducedMotion } from '@/services/motion';
import { hasTauriInvokeBridge, invokeTauri } from '@/services/tauri-bridge';

const ONBOARDING_KEY = 'cb:onboarding-complete';

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

const FREE_APIS = [
  { name: 'USGS Earthquakes', label: 'free' },
  { name: 'GDACS Disasters', label: 'free' },
  { name: 'Open-Meteo Weather', label: 'free' },
  { name: 'GDELT News', label: 'free' },
  { name: 'NewsAPI', label: 'free tier' },
  { name: 'OpenWeatherMap', label: 'free tier' },
];

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

  constructor(options: WelcomeFlowOptions = {}) {
    this.options = options;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cb-backdrop';
    Object.assign(this.backdrop.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    this.modal = document.createElement('div');
    this.modal.className = 'cb-modal-content';
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
  }

  static shouldShow(): boolean {
    return localStorage.getItem(ONBOARDING_KEY) !== 'true';
  }

  show(): void {
    document.body.append(this.backdrop);
    this.renderDots();
    this.renderStep();
    void animateIn(this.modal, 'scale');
  }

  private close(): void {
    this.modal.classList.add('closing');
    this.backdrop.classList.add('closing');

    this.backdrop.addEventListener('animationend', () => this.backdrop.remove(), { once: true });
    // Fallback if reduced-motion or animation doesn't fire
    setTimeout(() => this.backdrop.remove(), 500);
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

    if (hasTauriInvokeBridge()) {
      void invokeTauri<[number, number]>('get_native_location')
        .then(([lat, lon]) => {
          this.options.onLocationSet?.(lat, lon);
          this.advance();
        })
        .catch(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        });
      return;
    }

    if (!navigator.geolocation) {
      this.advance();
      return;
    }
    // eslint-disable-next-line sonarjs/no-intrusive-permissions
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.options.onLocationSet?.(pos.coords.latitude, pos.coords.longitude);
        this.advance();
      },
      () => {
        btn.textContent = originalText;
        btn.disabled = false;
      },
      { timeout: 8000 },
    );
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
    desc.textContent = 'These free sources work right away — no key needed.';
    Object.assign(desc.style, {
      margin: '0',
      fontSize: 'var(--text-sm)',
      color: '#888',
      fontFamily: 'var(--font-ui)',
    });

    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.06)',
    });

    for (const api of FREE_APIS) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) var(--space-3)',
        background: 'rgba(255,255,255,0.02)',
        fontFamily: 'var(--font-ui)',
      });

      const name = document.createElement('span');
      name.textContent = api.name;
      Object.assign(name.style, {
        fontSize: 'var(--text-sm)',
        color: '#ccc',
      });

      const badge = document.createElement('span');
      badge.textContent = api.label;
      Object.assign(badge.style, {
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--fw-medium)',
        color: '#4ade80',
        background: 'rgba(74, 222, 128, 0.1)',
        border: '1px solid rgba(74, 222, 128, 0.2)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px var(--space-2)',
      });

      row.append(name, badge);
      list.append(row);
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
      this.options.onComplete?.();
    });

    btnRow.append(skipBtn, settingsBtn);
    this.stepEl.append(title, desc, list, btnRow);
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
    localStorage.setItem(ONBOARDING_KEY, 'true');
    this.options.onComplete?.();
    this.close();
  }
}
