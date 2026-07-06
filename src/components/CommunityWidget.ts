import { t } from '@/services/i18n';

const DISMISSED_KEY = 'wm-community-dismissed';
const DISCUSSION_URL = 'https://github.com/bradleybond512/crystal-ball/discussions';

export function mountCommunityWidget(): void {
  if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
  if (document.querySelector('.community-widget')) return;

  // Single close control: the × IS "don't show again" (persisted). The old
  // separate ghost-text button doubled up with the pill and z-fought the
  // Alert Replay scrubber.
  const widget = document.createElement('div');
  widget.className = 'community-widget';
  widget.innerHTML = `
 <div class="cw-pill">
 <div class="cw-dot"></div>
 <a class="cw-cta" href="${DISCUSSION_URL}" target="_blank" rel="noopener">${t('components.community.joinDiscussion')}</a>
 <button class="cw-close" aria-label="${t('components.community.dontShowAgain')}" title="${t('components.community.dontShowAgain')}">&times;</button>
 </div>
  `;

  widget.querySelector('.cw-close')!.addEventListener('click', () => {
 localStorage.setItem(DISMISSED_KEY, 'true');
 widget.classList.add('cw-hiding');
 setTimeout(() => widget.remove(), 300);
  });

  document.body.append(widget);
}
