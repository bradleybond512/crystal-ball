interface EmptyStateOptions {
  icon: string;
  title: string;
  message: string;
  cta?: { label: string; onClick: () => void };
}

type EmptyStateCategory = 'geopolitical' | 'infrastructure' | 'cyber' | 'markets' | 'weather' | 'user' | 'alerts';

export function renderEmptyState(options: EmptyStateOptions): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:var(--space-4,16px)',
    'padding:var(--space-6,24px)',
    'text-align:center',
  ].join(';');

  const iconEl = document.createElement('span');
  iconEl.style.cssText = 'font-size:28px;opacity:0.4;line-height:1';
  iconEl.textContent = options.icon;
  wrapper.append(iconEl);

  const titleEl = document.createElement('p');
  titleEl.style.cssText = [
    'margin:0',
    'font-family:var(--font-ui)',
    'font-size:var(--text-base,13px)',
    'font-weight:var(--fw-medium,500)',
  ].join(';');
  titleEl.textContent = options.title;
  wrapper.append(titleEl);

  const msgEl = document.createElement('p');
  msgEl.style.cssText = [
    'margin:0',
    'font-family:var(--font-ui)',
    'font-size:var(--text-xs,11px)',
    'opacity:0.6',
  ].join(';');
  msgEl.textContent = options.message;
  wrapper.append(msgEl);

  if (options.cta) {
    const btn = document.createElement('button');
    btn.className = 'cb-button accent';
    btn.textContent = options.cta.label;
    btn.addEventListener('click', options.cta.onClick);
    wrapper.append(btn);
  }

  return wrapper;
}

export function getEmptyStateDefaults(category: EmptyStateCategory): EmptyStateOptions {
  const defaults: Record<EmptyStateCategory, EmptyStateOptions> = {
    geopolitical: {
      icon: '🌍',
      title: 'No geopolitical alerts',
      message: 'When conflicts or political events are detected, they\'ll appear here.',
    },
    infrastructure: {
      icon: '🏗️',
      title: 'No infrastructure alerts',
      message: 'Power grid, pipeline, and telecom disruptions will appear here.',
    },
    cyber: {
      icon: '🛡️',
      title: 'No cyber threats detected',
      message: 'Cyber incidents and vulnerability alerts will appear here.',
    },
    markets: {
      icon: '📊',
      title: 'No market alerts',
      message: 'Significant market movements will appear here.',
    },
    weather: {
      icon: '⛅',
      title: 'No weather alerts',
      message: 'Severe weather warnings and natural disaster alerts will appear here.',
    },
    user: {
      icon: '👤',
      title: 'No activity',
      message: 'User-related notifications will appear here.',
    },
    alerts: {
      icon: '🔔',
      title: 'All clear',
      message: 'No active alerts. You\'re up to date.',
    },
  };
  return defaults[category];
}

export class EmptyState {
  private element: HTMLElement | null = null;
  private options: EmptyStateOptions;

  constructor(options: EmptyStateOptions) {
    this.options = options;
  }

  mount(container: HTMLElement): void {
    this.element = renderEmptyState(this.options);
    container.append(this.element);
  }

  unmount(): void {
    if (this.element?.parentElement) {
      this.element.remove();
    }
    this.element = null;
  }
}
