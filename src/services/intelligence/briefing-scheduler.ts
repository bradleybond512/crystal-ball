import { isDesktopRuntime } from '../runtime';
import { invokeTauri } from '../tauri-bridge';
import { logDebug } from '../reasoning-debug';

export interface BriefingSchedule {
  enabled: boolean;
  hour: number;       // 0-23
  minute: number;     // 0-59
  outputMethod: 'save' | 'email';
  emailAddress: string;
  lastGeneratedAt: number | null;
}

export const BRIEFING_SCHEDULE_KEY = 'wm-briefing-schedule';

// Pure helpers

export function parseTimeString(s: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) throw new Error(`Invalid time string: "${s}"`);
  const hour = Number.parseInt(match[1]!, 10);
  const minute = Number.parseInt(match[2]!, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Out of range time: "${s}"`);
  }
  return { hour, minute };
}

export function isValidEmail(email: string): boolean {
  if (!email) return false;
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return false;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!local || !domain?.includes('.')) return false;
  return true;
}

export function msUntilNextFire(schedule: BriefingSchedule, now: Date): number {
  const target = new Date(now);
  target.setHours(schedule.hour, schedule.minute, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

export function describeSchedule(schedule: BriefingSchedule): string {
  if (!schedule.enabled) return 'Disabled';
  const hh = String(schedule.hour).padStart(2, '0');
  const mm = String(schedule.minute).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (schedule.outputMethod === 'email') {
    return `Daily at ${time} → email to ${schedule.emailAddress}`;
  }
  return `Daily at ${time} → save to ~/Documents/Crystal Ball Briefs/`;
}

export function defaultSchedule(): BriefingSchedule {
  return {
    enabled: false,
    hour: 7,
    minute: 0,
    outputMethod: 'save',
    emailAddress: '',
    lastGeneratedAt: null,
  };
}

export function loadSchedule(): BriefingSchedule {
  try {
    const raw = localStorage.getItem(BRIEFING_SCHEDULE_KEY);
    if (!raw) return defaultSchedule();
    const parsed = JSON.parse(raw) as Partial<BriefingSchedule>;
    const def = defaultSchedule();
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : def.enabled,
      hour: typeof parsed.hour === 'number' && parsed.hour >= 0 && parsed.hour <= 23
        ? parsed.hour
        : def.hour,
      minute: typeof parsed.minute === 'number' && parsed.minute >= 0 && parsed.minute <= 59
        ? parsed.minute
        : def.minute,
      outputMethod: parsed.outputMethod === 'email' || parsed.outputMethod === 'save'
        ? parsed.outputMethod
        : def.outputMethod,
      emailAddress: typeof parsed.emailAddress === 'string' ? parsed.emailAddress : def.emailAddress,
      lastGeneratedAt: typeof parsed.lastGeneratedAt === 'number'
        ? parsed.lastGeneratedAt
        : null,
    };
  } catch {
    return defaultSchedule();
  }
}

export function saveSchedule(schedule: BriefingSchedule): void {
  localStorage.setItem(BRIEFING_SCHEDULE_KEY, JSON.stringify(schedule));
}

export class BriefingScheduler {
  private schedule: BriefingSchedule;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private onFire: () => Promise<void>;
  private buildPdfBytes?: () => Promise<Uint8Array | null>;

  constructor(
    onFire: () => Promise<void>,
    buildPdfBytes?: () => Promise<Uint8Array | null>,
  ) {
    this.schedule = loadSchedule();
    this.onFire = onFire;
    this.buildPdfBytes = buildPdfBytes;
  }

  getSchedule(): BriefingSchedule { return { ...this.schedule }; }

  update(patch: Partial<BriefingSchedule>): void {
    this.schedule = { ...this.schedule, ...patch };
    saveSchedule(this.schedule);
    this.reschedule();
  }

  start(): void { this.reschedule(); }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private reschedule(): void {
    this.stop();
    if (!this.schedule.enabled) return;
    const delay = msUntilNextFire(this.schedule, new Date());
    this.timerId = setTimeout(() => {
      void this.fire();
    }, delay);
  }

  private async fire(): Promise<void> {
    try {
      if (this.buildPdfBytes && isDesktopRuntime()) {
        await this.fireTauri();
      } else {
        await this.onFire();
      }
      this.schedule.lastGeneratedAt = Date.now();
      saveSchedule(this.schedule);
    } catch (error) {
      // Swallow the failure here so the rejected promise from `void this.fire()`
      // doesn't surface as an unhandled rejection. The finally below still
      // schedules the next run at its normal time rather than retrying in a
      // tight loop.
      logDebug({ level: 'error', category: 'forecast', source: 'briefing-scheduler',
        message: 'briefing generation failed',
        data: { error: error instanceof Error ? error.message : String(error) } });
    } finally {
      this.reschedule();
    }
  }

  private async fireTauri(): Promise<void> {
    const bytes = await this.buildPdfBytes!();
    if (!bytes) return;
    const iso = new Date().toISOString().slice(0, 10);
    const filename = `brief-${iso}.pdf`;
    await invokeTauri<string>('save_brief', { filename, bytes: Array.from(bytes) });
  }
}
