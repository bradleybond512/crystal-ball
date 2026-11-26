import type { GlobeTimeMachine, GlobeTimeMachineState } from '@/components/GlobeTimeMachine';

const DAY_MS = 24 * 60 * 60 * 1000;
const SPEEDS = [1, 4, 16, 64] as const;

export class TimeScrubberHud {
  private readonly el: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly latestBtn: HTMLButtonElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly zoneBadge: HTMLElement;
  private readonly cursorLabel: HTMLElement;
  private readonly anchorLabel: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly formatTime = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short',
  });
  private readonly onTogglePlay = (): void => this.controller.togglePlay();
  private readonly onScrub = (): void => this.controller.setTime(Number(this.slider.value));
  private readonly onLatest = (): void => this.controller.snapToNow();
  private readonly onSpeed = (): void => this.controller.setSpeed(Number(this.speedSelect.value));

  constructor(parent: HTMLElement, private readonly controller: GlobeTimeMachine) {
    this.el = document.createElement('div');
    this.el.className = 'time-scrubber-hud';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Current-record time filter');

    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'time-scrubber-hud__play';
    this.playBtn.addEventListener('click', this.onTogglePlay);

    this.zoneBadge = document.createElement('span');
    this.zoneBadge.className = 'time-scrubber-hud__zone';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'time-scrubber-hud__track';
    this.slider.step = '1000';
    this.slider.setAttribute('aria-label', 'Selected time');
    this.slider.addEventListener('input', this.onScrub);

    this.speedSelect = document.createElement('select');
    this.speedSelect.className = 'time-scrubber-hud__speed';
    this.speedSelect.setAttribute('aria-label', 'Playback speed');
    for (const speed of SPEEDS) {
      const option = document.createElement('option');
      option.value = String(speed);
      option.textContent = `${speed}x`;
      this.speedSelect.append(option);
    }
    this.speedSelect.addEventListener('change', this.onSpeed);

    this.latestBtn = document.createElement('button');
    this.latestBtn.type = 'button';
    this.latestBtn.className = 'time-scrubber-hud__latest';
    this.latestBtn.textContent = 'Latest';
    this.latestBtn.addEventListener('click', this.onLatest);

    this.cursorLabel = document.createElement('span');
    this.cursorLabel.className = 'time-scrubber-hud__cursor';
    this.anchorLabel = document.createElement('span');
    this.anchorLabel.className = 'time-scrubber-hud__anchor';
    const explanation = document.createElement('span');
    explanation.className = 'time-scrubber-hud__explanation';
    explanation.textContent = 'Filters timestamps in currently loaded data. Positions are not historical.';

    this.el.append(this.playBtn, this.zoneBadge, this.slider, this.speedSelect,
      this.latestBtn, this.cursorLabel, this.anchorLabel, explanation);
    parent.append(this.el);
    this.render(controller.getState());
    this.unsubscribe = controller.onStateChange(state => this.render(state));
  }

  get element(): HTMLElement { return this.el; }
  get cursorMs(): number { return this.controller.getCurrentMs(); }

  private render(state: GlobeTimeMachineState): void {
    this.playBtn.textContent = state.playing ? 'Pause' : 'Play';
    this.playBtn.setAttribute('aria-pressed', String(state.playing));
    this.zoneBadge.textContent = state.mode === 'latest' ? 'Current records' : 'Selected time';
    this.zoneBadge.dataset.zone = state.mode;
    const cursorTime = this.formatTime.format(state.cursorMs);
    this.cursorLabel.textContent = `Selected: ${cursorTime}`;
    this.anchorLabel.textContent = `Range ends: ${this.formatTime.format(state.anchorMs)}`;
    this.slider.min = String(state.anchorMs - DAY_MS);
    this.slider.max = String(state.anchorMs);
    this.slider.value = String(state.cursorMs);
    this.slider.setAttribute('aria-valuetext', cursorTime);
    this.speedSelect.value = String(state.speed);
  }

  destroy(): void {
    this.unsubscribe();
    this.playBtn.removeEventListener('click', this.onTogglePlay);
    this.slider.removeEventListener('input', this.onScrub);
    this.latestBtn.removeEventListener('click', this.onLatest);
    this.speedSelect.removeEventListener('change', this.onSpeed);
    this.el.remove();
  }
}
