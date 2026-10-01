/**
 * R4-BUG-001: a persistent "iMessage alerts are paused" notice outside
 * Settings. Mounted at the top of the Home Shell viewport (the default
 * opening surface, which covers the notification stack) and in the
 * NotificationStack for classic view.
 *
 * It never enables sending:
 *   - Review   → Settings → General → iMessage (the native dialog authorizes).
 *   - Keep off → an explicit native "off" (no dialog); ends the pause.
 *   - Not now  → hidden for this session only; it returns next launch.
 */
import {
  disableImessage,
  getImessagePauseState,
  IMESSAGE_PAUSE_EVENT,
  type ImessagePauseState,
  type ImessageResult,
} from '@/services/imessage-bridge';

export interface ImessagePausedNoticeDeps {
  pauseState: () => ImessagePauseState;
  keepOff: () => Promise<ImessageResult>;
  review: () => void;
}

const DEFAULT_DEPS: ImessagePausedNoticeDeps = {
  pauseState: getImessagePauseState,
  keepOff: disableImessage,
  review: () => document.dispatchEvent(new CustomEvent('wm:open-settings', { detail: { focus: 'imessage' } })),
};

// Shared by every mounted copy: "Not now" in one hides both.
let hiddenForSession = false;

/** Test hook: start a fresh app session. */
export function resetImessagePausedNoticeSession(): void {
  hiddenForSession = false;
}

function actionButton(label: string, action: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cb-imessage-paused-action';
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

/** Mounts the notice as the first child of `parent`; returns an unmount function. */
export function mountImessagePausedNotice(
  parent: HTMLElement,
  deps: ImessagePausedNoticeDeps = DEFAULT_DEPS,
): () => void {
  const root = document.createElement('div');
  root.className = 'cb-imessage-paused';
  root.setAttribute('role', 'status');
  root.hidden = true;
  const text = document.createElement('span');
  text.className = 'cb-imessage-paused-text';
  const review = actionButton('Review', 'review');
  const keepOff = actionButton('Keep off', 'keep-off');
  const later = actionButton('Not now', 'later');
  const actions = document.createElement('div');
  actions.className = 'cb-imessage-paused-actions';
  actions.append(review, keepOff, later);
  root.append(text, actions);

  let busy = false;
  let failure = '';
  const render = (): void => {
    const state = deps.pauseState();
    root.hidden = !state.paused || hiddenForSession;
    if (state.paused) {
      // textContent only: the hint comes from local storage.
      text.textContent = failure || `iMessage alerts are paused. Confirm the recipient (${state.hint}) to resume.`;
    }
    for (const button of [review, keepOff, later]) button.disabled = busy;
  };

  review.addEventListener('click', () => deps.review());
  keepOff.addEventListener('click', () => {
    // render() disables every button while busy, so a second click cannot land.
    busy = true;
    failure = '';
    render();
    void deps.keepOff()
      .then((result) => { failure = result.ok ? '' : result.reason; })
      .catch(() => { failure = 'iMessage settings are unavailable. Sending is disabled.'; })
      .finally(() => { busy = false; render(); });
  });
  later.addEventListener('click', () => {
    hiddenForSession = true;
    document.dispatchEvent(new CustomEvent(IMESSAGE_PAUSE_EVENT));
  });

  document.addEventListener(IMESSAGE_PAUSE_EVENT, render);
  parent.prepend(root);
  render();
  return () => {
    document.removeEventListener(IMESSAGE_PAUSE_EVENT, render);
    root.remove();
  };
}
