import english from './ghost-notice-en.json';
import { mountEarlyGhostModeNotice } from '../components/GhostModeNotice';
import { notificationStack } from '../components/NotificationStack';

export function mountGhostBootNotice(): { showStartupFailure(): void } {
  const host = notificationStack.element;
  host.classList.add('cb-ghost-boot-host');
  notificationStack.mount();
  mountEarlyGhostModeNotice(host);

  return {
    showStartupFailure() {
      host.classList.add('cb-ghost-boot-host');
      if (host.querySelector('.cb-ghost-startup-failure')) return;
      const failure = document.createElement('p');
      failure.className = 'cb-ghost-startup-failure';
      failure.setAttribute('role', 'status');
      failure.tabIndex = -1;
      failure.textContent = english.startupFailed;
      host.append(failure);
    },
  };
}
