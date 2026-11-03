import english from '../bootstrap/ghost-notice-en.json';
import {
  getGhostModeState, GHOST_COUNT_LIMIT, setMode, subscribeGhostMode, toggleGhostMode,
} from '@/services/mode-manager';

const modeActions = {
  snapshot: getGhostModeState,
  subscribe: subscribeGhostMode,
  exit: toggleGhostMode,
  choose: setMode,
};

type CopyKey = keyof typeof english;
type Translate = (key: CopyKey, values?: { muted: string; critical: string }) => string;

const bootCopy: Translate = (key, values) => values
  ? english[key].replace('{{muted}}', values.muted).replace('{{critical}}', values.critical)
  : english[key];

function shownCount(value: number): string {
  return value.toLocaleString(document.documentElement.lang || 'en') + (value >= GHOST_COUNT_LIMIT ? '+' : '');
}

function createNotice(parent: HTMLElement, deps: typeof modeActions) {
  let copy = bootCopy;
  const root = document.createElement('div');
  root.className = 'cb-ghost-notice';
  const details = document.createElement('div');
  const message = document.createElement('div');
  message.className = 'cb-ghost-notice-message';
  message.setAttribute('role', 'status');
  const counts = document.createElement('div');
  counts.className = 'cb-ghost-notice-count';
  const actions = document.createElement('div');
  actions.className = 'cb-ghost-notice-actions';

  function button(id: string, handler: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.action = id;
    el.addEventListener('click', handler);
    actions.append(el);
    return el;
  }

  const exit = button('exit-ghost', deps.exit);
  const standard = button('use-standard', () => deps.choose(null));
  const ghost = button('use-ghost', () => deps.choose('ghost'));
  const save = button('save-mode', () => deps.choose(deps.snapshot().mode));
  details.append(message, counts);
  root.append(details, actions);
  parent.prepend(root);

  function render(): void {
    const { mode, preference, muted, critical } = deps.snapshot();
    const unknown = preference === 'unknown';
    const unsaved = preference === 'window-only';
    const active = mode === 'ghost' && !unknown;
    const focused = document.activeElement;
    root.hidden = !active && !unknown && !unsaved;
    let summary = '';
    if (unknown) summary = copy('unknown');
    else if (active) summary = copy('active');
    else if (unsaved) summary = copy(mode === 'gods-vision' ? 'vision' : 'standard');
    if (unsaved) summary += ' ' + copy('unsaved');
    if (message.textContent !== summary) message.textContent = summary;
    counts.hidden = !active;
    counts.textContent = active ? copy('counts', { muted: shownCount(muted), critical: shownCount(critical) }) : '';
    exit.hidden = !active;
    standard.hidden = !unknown;
    ghost.hidden = !unknown;
    save.hidden = !unsaved;

    if (focused instanceof HTMLButtonElement && actions.contains(focused) && (root.hidden || focused.hidden)) {
      const trigger = parent.closest('.home-shell')?.querySelector<HTMLButtonElement>('.home-shell-cmdk')
        ?? document.getElementById('ghostModeBtn') ?? document.getElementById('searchBtn')
        ?? parent.querySelector<HTMLElement>('.cb-ghost-startup-failure');
      const next = root.hidden ? trigger : actions.querySelector<HTMLButtonElement>('button:not([hidden])');
      next?.focus();
    }
  }

  function translate(): void {
    exit.textContent = copy('exit');
    standard.textContent = copy('useStandard');
    ghost.textContent = copy('useGhost');
    save.textContent = copy('retry');
    render();
  }

  const unsubscribe = deps.subscribe(render);
  translate();
  return {
    setLanguage(next: Translate) { copy = next; translate(); },
    unmount() { unsubscribe(); root.remove(); },
  };
}

const earlyViews = new WeakMap<HTMLElement, ReturnType<typeof createNotice>>();

export function mountEarlyGhostModeNotice(parent: HTMLElement): void {
  if (!earlyViews.has(parent)) earlyViews.set(parent, createNotice(parent, modeActions));
}

export function mountGhostModeNotice(parent: HTMLElement, deps = modeActions): () => void {
  const view = earlyViews.get(parent) ?? createNotice(parent, deps);
  earlyViews.delete(parent);
  if (!parent.querySelector('.cb-ghost-startup-failure')) parent.classList.remove('cb-ghost-boot-host');

  // A denied cold start can show the English status before the main app or its locale loads.
  let mounted = true;
  let stopLanguage: (() => void) | undefined;
  void import('i18next').then(({ default: i18n }) => {
    if (!mounted) return;
    const localize = () => view.setLanguage((key, values) => i18n.t(`ghostNotice.${key}`, {
      ...values, defaultValue: english[key],
    }));
    if (i18n.isInitialized) localize();
    else {
      i18n.on('initialized', localize);
      stopLanguage = () => i18n.off('initialized', localize);
    }
  }).catch(() => { /* The boot copy remains usable without translations. */ });

  return () => {
    mounted = false;
    stopLanguage?.();
    view.unmount();
  };
}
