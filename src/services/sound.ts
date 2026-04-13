import { isGhostMode } from '@/services/mode-manager';

const MIN_INTERVAL_MS = 3000;
let lastPlayedAt = 0;

function getVolume(): number {
  const raw = localStorage.getItem('cb:sound-volume');
  const parsed = Number.parseFloat(raw ?? '');
  return Number.isNaN(parsed) ? 0.3 : Math.max(0, Math.min(1, parsed));
}

function isSoundEnabled(): boolean {
  const raw = localStorage.getItem('cb:sound-enabled');
  return raw !== 'false';
}

function canPlay(): boolean {
  if (isGhostMode()) return false;
  if (!isSoundEnabled()) return false;
  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return false;
  lastPlayedAt = now;
  return true;
}

let sharedCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
    sharedCtx = new AudioContext();
    return sharedCtx;
  } catch {
    return null;
  }
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playAlertSound(severity: 'critical' | 'high' | 'elevated'): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  const vol = getVolume();
  const now = ctx.currentTime;

  if (severity === 'critical') {
    // C5 to E5 rising chime (300ms)
    playTone(ctx, 523.25, now, 0.15, vol);
    playTone(ctx, 659.25, now + 0.15, 0.15, vol);
  } else if (severity === 'high') {
    // G4 single tone (200ms)
    playTone(ctx, 392, now, 0.2, vol);
  } else {
    // Elevated: 800Hz tap (50ms)
    playTone(ctx, 800, now, 0.05, vol);
  }
}

export function playAckSound(): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  const vol = getVolume();
  const now = ctx.currentTime;

  // E4 to C4 descending (150ms)
  playTone(ctx, 329.63, now, 0.075, vol);
  playTone(ctx, 261.63, now + 0.075, 0.075, vol);
}
