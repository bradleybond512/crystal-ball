import type {
  AttentionSnapshot,
  PanelAttention,
} from '@/services/panel-attention';

interface AttentionNavigatorOptions {
  onReview: (panelId: string) => string | undefined | void;
  getPanelName?: (panelId: string) => string;
}

const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Emerging',
  low: 'New',
  info: 'New',
} as const;

function makeButton(label: string, action: string, panelId?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `attention-navigator-button attention-navigator-${action}`;
  button.dataset.attentionAction = action;
  if (panelId) button.dataset.panelId = panelId;
  button.textContent = label;
  return button;
}

function unreviewedPanels(snapshot: AttentionSnapshot): PanelAttention[] {
  return snapshot.panels.filter((panel) => panel.unreviewedCount > 0);
}

function clearAttentionDecorations(): void {
  document.querySelectorAll<HTMLElement>(
    '.panel[data-panel][data-attention-severity], .mac-sidebar-panel-item[data-attention-severity]',
  ).forEach((element) => element.removeAttribute('data-attention-severity'));
  document.querySelectorAll('.panel-attention-chip, .panel-attention-sidebar-label').forEach((element) => {
    element.remove();
  });
}

export function applyAttentionDecorations(snapshot: AttentionSnapshot): void {
  const panels = new Map(
    unreviewedPanels(snapshot).map((panel) => [panel.panelId, panel]),
  );

  document.querySelectorAll<HTMLElement>('.panel[data-panel]').forEach((element) => {
    const panel = panels.get(element.dataset.panel ?? '');
    const existing = element.querySelector<HTMLElement>('.panel-attention-chip');
    if (!panel) {
      element.removeAttribute('data-attention-severity');
      existing?.remove();
      return;
    }
    element.dataset.attentionSeverity = panel.maxSeverity;
    const header = element.querySelector<HTMLElement>('.panel-header, .cb-panel-header');
    if (!header) return;
    const chip = existing ?? document.createElement('span');
    if (!existing) {
      chip.className = 'panel-attention-chip';
      header.append(chip);
    }
    chip.dataset.attentionSeverity = panel.maxSeverity;
    const text = `${SEVERITY_LABELS[panel.maxSeverity]} · ${panel.unreviewedCount} unreviewed`;
    if (chip.textContent !== text) chip.textContent = text;
  });

  document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach((element) => {
    const panel = panels.get(element.dataset.panelKey ?? '');
    const existing = element.querySelector<HTMLElement>('.panel-attention-sidebar-label');
    if (!panel) {
      element.removeAttribute('data-attention-severity');
      existing?.remove();
      return;
    }
    element.dataset.attentionSeverity = panel.maxSeverity;
    const label = existing ?? document.createElement('span');
    if (!existing) {
      label.className = 'panel-attention-sidebar-label';
      element.append(label);
    }
    label.dataset.attentionSeverity = panel.maxSeverity;
    const text = `${SEVERITY_LABELS[panel.maxSeverity]} ${panel.unreviewedCount}`;
    if (label.textContent !== text) label.textContent = text;
  });
}

export class AttentionNavigator {
  private readonly element: HTMLElement;
  private readonly summaryElement: HTMLElement;
  private readonly listElement: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly onReview: (panelId: string) => string | undefined | void;
  private readonly getPanelName: (panelId: string) => string;
  private snapshot: AttentionSnapshot = { panels: [], severityCounts: {}, promotedPanelIds: [] };
  private persistenceDegraded = false;
  private snapshotSignature = '';

  constructor(options: AttentionNavigatorOptions) {
    this.onReview = options.onReview;
    this.getPanelName = options.getPanelName ?? ((panelId) => panelId);
    this.element = document.createElement('section');
    this.element.className = 'attention-navigator';
    this.element.setAttribute('aria-label', 'Pane review navigator');
    this.element.addEventListener('click', this.onClick);

    const header = document.createElement('div');
    header.className = 'attention-navigator-header';
    const title = document.createElement('strong');
    title.textContent = 'Review trail';
    this.summaryElement = document.createElement('span');
    this.summaryElement.className = 'attention-navigator-summary';
    this.summaryElement.setAttribute('aria-live', 'polite');
    this.nextButton = makeButton('Next unreviewed', 'next');
    header.append(title, this.summaryElement, this.nextButton);

    this.listElement = document.createElement('div');
    this.listElement.className = 'attention-navigator-list';
    this.element.append(header, this.listElement);
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    this.render();
  }

  update(snapshot: AttentionSnapshot): void {
    const signature = JSON.stringify(snapshot);
    if (signature === this.snapshotSignature) return;
    this.snapshotSignature = signature;
    this.snapshot = snapshot;
    this.render();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  setPersistenceDegraded(degraded: boolean): void {
    if (this.persistenceDegraded === degraded) return;
    this.persistenceDegraded = degraded;
    this.render();
  }

  destroy(): void {
    this.element.removeEventListener('click', this.onClick);
    this.element.remove();
    clearAttentionDecorations();
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-attention-action]');
    if (!button || !this.element.contains(button) || button.disabled) return;
    const action = button.dataset.attentionAction;
    if (action === 'next') {
      const first = unreviewedPanels(this.snapshot)[0];
      if (first) this.navigate(first.panelId);
      return;
    }
    const panelId = button.dataset.panelId;
    if (!panelId) return;
    if (action === 'open') this.navigate(panelId);
    else if (action === 'review') {
      const nextPanelId = this.onReview(panelId);
      if (typeof nextPanelId === 'string' && nextPanelId.length > 0) {
        this.navigate(nextPanelId);
        const nextReview = [...this.element.querySelectorAll<HTMLButtonElement>(
          '[data-attention-action="review"]',
        )].find((candidate) => candidate.dataset.panelId === nextPanelId);
        (nextReview ?? this.nextButton).focus();
      } else {
        this.nextButton.focus();
      }
    }
  };

  private navigate(panelId: string): void {
    const eventName = document.body.classList.contains('home-shell-active')
      ? 'cb:open-panel'
      : 'cb:navigate-panel';
    document.dispatchEvent(new CustomEvent(eventName, { detail: { panelKey: panelId } }));
  }

  private render(): void {
    const focused = document.activeElement?.closest<HTMLElement>('[data-attention-action]');
    const focusInside = this.element.contains(focused ?? null);
    const focusAction = focusInside ? focused?.dataset.attentionAction : undefined;
    const focusPanel = focusInside ? focused?.dataset.panelId : undefined;
    const panels = unreviewedPanels(this.snapshot);
    if (panels.length === 0) {
      this.summaryElement.textContent = 'Review queue clear';
    } else {
      const critical = this.snapshot.severityCounts.critical ?? 0;
      const high = this.snapshot.severityCounts.high ?? 0;
      const emerging = this.snapshot.severityCounts.medium ?? 0;
      const fresh = (this.snapshot.severityCounts.low ?? 0) + (this.snapshot.severityCounts.info ?? 0);
      this.summaryElement.textContent = `${critical} critical · ${high} high · ${emerging} emerging · ${fresh} new`;
    }
    if (this.persistenceDegraded) this.summaryElement.textContent += ' · review history is session-only';
    this.nextButton.disabled = panels.length === 0;

    this.listElement.replaceChildren();
    for (const panel of panels) {
      const panelName = this.getPanelName(panel.panelId);
      const row = document.createElement('div');
      row.className = 'attention-navigator-item';
      row.dataset.attentionPanel = panel.panelId;
      row.dataset.attentionSeverity = panel.maxSeverity;
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${panelName}, ${SEVERITY_LABELS[panel.maxSeverity]}, ${panel.unreviewedCount} unreviewed`);
      const severity = document.createElement('span');
      severity.className = 'attention-navigator-severity';
      severity.textContent = SEVERITY_LABELS[panel.maxSeverity];
      const name = document.createElement('span');
      name.className = 'attention-navigator-name';
      name.textContent = panelName;
      const count = document.createElement('span');
      count.className = 'attention-navigator-count';
      count.textContent = `${panel.unreviewedCount} unreviewed`;
      const open = makeButton('Open', 'open', panel.panelId);
      open.setAttribute('aria-label', `Open ${panelName}`);
      const review = makeButton('Mark reviewed', 'review', panel.panelId);
      review.setAttribute('aria-label', `Mark ${panelName} reviewed`);
      row.append(severity, name, count, open, review);
      this.listElement.append(row);
    }

    if (focusAction) {
      const match = [...this.element.querySelectorAll<HTMLElement>('[data-attention-action]')]
        .find((candidate) => candidate.dataset.attentionAction === focusAction
          && candidate.dataset.panelId === focusPanel);
      match?.focus();
    }
  }
}
