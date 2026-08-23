import type { HomeShellReadinessView } from '@/services/home-shell/startup-readiness-view';

export interface HomeShellStartupReadinessActions {
  onRetryAll: () => void;
  onOpenSettings: () => void;
}

export interface HomeShellStartupReadinessPresenter {
  readonly element: HTMLElement;
  readonly liveRegion: HTMLElement;
  /** Returns true only when the visible view changed and the live node was replaced. */
  update: (view: HomeShellReadinessView) => boolean;
}

function viewSignature(view: HomeShellReadinessView): string {
  const sourceSignature = view.sources
    .map((source) => [source.id, source.state, source.statusLabel, source.nextStep, source.canRetryAllData].join(':'))
    .join('|');
  return [view.state, view.label, view.headline, view.summary, view.setupNote, sourceSignature, String(view.showRetryAll)].join('\u0000');
}

function createLiveRegion(view: HomeShellReadinessView): HTMLElement {
  const live = document.createElement('div');
  live.className = 'hs-readiness-copy';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  live.setAttribute('aria-label', view.label);

  const label = document.createElement('div');
  label.className = 'hs-readiness-label';
  label.textContent = view.label;
  const headline = document.createElement('div');
  headline.className = 'hs-readiness-headline';
  headline.textContent = view.headline;
  const summary = document.createElement('div');
  summary.className = 'hs-readiness-summary';
  summary.textContent = view.summary;
  const setup = document.createElement('div');
  setup.className = 'hs-readiness-setup';
  setup.textContent = view.setupNote;
  const sources = document.createElement('ul');
  sources.className = 'hs-readiness-sources';
  sources.setAttribute('aria-label', 'Keyless source readiness');
  for (const source of view.sources) {
    const row = document.createElement('li');
    row.className = `hs-readiness-source hs-source-${source.state}`;
    row.dataset.sourceId = source.id;
    row.dataset.sourceState = source.state;
    const name = document.createElement('span');
    name.className = 'hs-source-name';
    name.textContent = source.name;
    const status = document.createElement('span');
    status.className = 'hs-source-status';
    status.textContent = source.statusLabel;
    const next = document.createElement('span');
    next.className = 'hs-source-next';
    next.textContent = source.nextStep;
    row.append(name, status, next);
    sources.append(row);
  }
  live.append(label, headline, summary, sources, setup);
  return live;
}

export function createHomeShellStartupReadiness(
  initialView: HomeShellReadinessView,
  actions: HomeShellStartupReadinessActions,
): HomeShellStartupReadinessPresenter {
  const element = document.createElement('section');
  element.className = 'home-shell-readiness';
  element.setAttribute('aria-label', 'Deck startup information');

  const liveSlot = document.createElement('div');
  liveSlot.className = 'hs-readiness-live-slot';
  const controls = document.createElement('div');
  controls.className = 'hs-readiness-actions';
  element.append(liveSlot, controls);

  let signature: string | undefined;
  let liveRegion: HTMLElement;

  const update = (view: HomeShellReadinessView): boolean => {
    const nextSignature = viewSignature(view);
    if (nextSignature === signature) return false;

    element.className = `home-shell-readiness hs-readiness-${view.state}`;
    liveRegion = createLiveRegion(view);
    liveSlot.replaceChildren(liveRegion);

    const nextControls: HTMLButtonElement[] = [];
    if (view.showRetryAll) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.action = 'readiness-retry-all';
      retry.textContent = 'Retry all data';
      retry.addEventListener('click', actions.onRetryAll);
      nextControls.push(retry);
    }
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.dataset.action = 'readiness-settings';
    settings.textContent = 'Optional setup';
    settings.addEventListener('click', actions.onOpenSettings);
    nextControls.push(settings);
    controls.replaceChildren(...nextControls);

    signature = nextSignature;
    return true;
  };

  update(initialView);
  return {
    element,
    get liveRegion() { return liveRegion; },
    update,
  };
}
