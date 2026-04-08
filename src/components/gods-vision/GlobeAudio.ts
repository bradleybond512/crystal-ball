import type { AppMode } from '@/services/mode-manager';

const MODE_CONFIG: Record<string, { freq: number; gain: number; lfo: number }> = {
  ghost: { freq: 30, gain: 0.05, lfo: 0.2 },
  'gods-vision': { freq: 60, gain: 0.04, lfo: 0.3 },
};
const DEFAULT_AUDIO_CFG = { freq: 60, gain: 0.04, lfo: 0.3 };

export class GlobeAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private lfoGain: GainNode | null = null;
  private enabled = false;

  start(): void {
 if (this.enabled) return;
 this.enabled = true;
 this.ctx = new AudioContext();
 const ctx = this.ctx;

 this.osc = ctx.createOscillator();
 this.osc.type = 'sine';
 this.osc.frequency.value = 60;

 this.gainNode = ctx.createGain();
 this.gainNode.gain.value = 0;

 this.lfoOsc = ctx.createOscillator();
 this.lfoOsc.type = 'sine';
 this.lfoOsc.frequency.value = 0.3;

 this.lfoGain = ctx.createGain();
 this.lfoGain.gain.value = 0.01;

 this.lfoOsc.connect(this.lfoGain);
 this.lfoGain.connect(this.gainNode.gain);
 this.osc.connect(this.gainNode);
 this.gainNode.connect(ctx.destination);

 this.osc.start();
 this.lfoOsc.start();

 this.gainNode.gain.setTargetAtTime(0.04, ctx.currentTime, 1.5);
  }

  stop(): void {
 if (!this.enabled) return;
 this.enabled = false;
 if (this.gainNode && this.ctx) {
 this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
 window.setTimeout(() => {
 this.osc?.stop();
 this.lfoOsc?.stop();
 void this.ctx?.close();
 this.ctx = null;
 this.osc = null;
 this.lfoOsc = null;
 this.gainNode = null;
 this.lfoGain = null;
 }, 2000);
 }
  }

  setMode(mode: AppMode | null): void {
 if (!this.ctx || !this.osc || !this.gainNode || !this.lfoOsc) return;
 const cfg = (mode && MODE_CONFIG[mode]) ?? DEFAULT_AUDIO_CFG;
 const t = this.ctx.currentTime;
 this.osc.frequency.setTargetAtTime(cfg.freq, t, 2);
 this.gainNode.gain.setTargetAtTime(cfg.gain, t, 2);
 this.lfoOsc.frequency.setTargetAtTime(cfg.lfo, t, 2);
  }

  isEnabled(): boolean { return this.enabled; }
}
