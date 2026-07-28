// src/services/survival/comms-fallback.ts
//
// E6 · Survival Kernel hardening — the comms/radio fallback ladder.
//
// Communications don't fail all at once; they fail in tiers. Broadband dies with
// the mains power that runs the router. Cellular data and voice die when a tower
// loses backhaul or is overwhelmed. Copper landlines outlive a neighborhood
// blackout because the phone company's central office is battery-backed. Below
// all of that sit the things that need nothing but batteries — a NOAA weather
// radio to RECEIVE, a two-way radio to TRANSMIT — and, at the very bottom, your
// own two feet.
//
// grid-down-certify.ts proves an axis can be SEEN offline; offline-playbook.ts
// gives every elevated axis something to DO offline. This module answers the one
// question the comms axis raises that neither of those does: with the network
// degrading, HOW do I actually reach people? It resolves, from the snapshot
// alone, which rungs of the ladder are still viable, which single rung to reach
// for first, and the concrete fallback reference (weather-radio frequencies,
// FRS/GMRS calling channel, an out-of-area contact protocol).
//
// The model is deliberately conservative: each step down the comms band assumes
// one more infrastructure tier is gone, and a compromised power axis independently
// takes the mains-powered rungs with it. Battery- and no-infrastructure rungs are
// never assumed down, so a viable, transmit-capable fallback ALWAYS exists — the
// comms grid-down guarantee.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// snapshot alone.

import type { SurvivalBand, WorldSnapshot } from './survival-types.ts';
import { bandForLevel } from './survival-types.ts';
import { GUIDANCE_LEVEL } from './grid-down-certify.ts';

/** Infrastructure a comms method leans on. `battery` and `none` are never assumed
 *  down — they anchor the grid-down guarantee. */
export type CommsDependency =
  | 'internet'
  | 'cell_tower'
  | 'mains_power'
  | 'landline'
  | 'battery'
  | 'none';

export interface CommsRung {
  id: string;
  /** Short method name, e.g. "Cellular voice + SMS". */
  method: string;
  /** What to actually do on this rung. */
  instruction: string;
  dependsOn: CommsDependency[];
  /** Needs no network infrastructure (battery- or foot-powered). */
  offlineCapable: boolean;
  /** Can only receive, not transmit (a weather radio). */
  receiveOnly: boolean;
  /** All dependencies are assumed up at the assessed degradation. */
  viable: boolean;
  /** Static fallback reference (frequencies / channels), when applicable. */
  reference?: string;
}

export interface CommsCheckInProtocol {
  outOfAreaContact: string;
  meetingPoint: string;
  cadenceLabel: string;
}

export interface CommsFallbackPlan {
  capturedAtMs: number;
  commsLevel: number;
  commsBand: SurvivalBand;
  /** The energy_water axis is elevated — mains-powered rungs are assumed down. */
  powerCompromised: boolean;
  /** Full ladder, most-capable first, each flagged viable/down. */
  ladder: CommsRung[];
  /** Highest viable rung you can TRANSMIT on. Never null — the foot-powered
   *  runner rung is always viable. */
  recommendedRungId: string;
  /** Highest viable receive channel (weather radio when reachable), or null. */
  receiveRungId: string | null;
  checkIn: CommsCheckInProtocol;
  headline: string;
}

// ── The ladder ───────────────────────────────────────────────────────────────
// Ordered most-capable → most-resilient. Copper POTS depends on `landline`
// (central-office battery), NOT mains_power — its whole point is surviving a
// local blackout. The router that carries broadband, by contrast, dies with the
// mains.

interface RungDef {
  id: string;
  method: string;
  instruction: string;
  dependsOn: CommsDependency[];
  receiveOnly: boolean;
  reference?: string;
}

const LADDER: readonly RungDef[] = [
  {
    id: 'broadband_internet',
    method: 'Broadband internet',
    instruction: 'Message, email, or place a VoIP/video call over home or work Wi-Fi.',
    dependsOn: ['internet', 'mains_power'],
    receiveOnly: false,
  },
  {
    id: 'cellular_data',
    method: 'Cellular data',
    instruction: 'Use data messaging apps; keep messages short to fight congestion.',
    dependsOn: ['cell_tower'],
    receiveOnly: false,
  },
  {
    id: 'cellular_voice_sms',
    method: 'Cellular voice + SMS',
    instruction: 'Prefer SMS — it stores-and-forwards through congestion that blocks calls.',
    dependsOn: ['cell_tower'],
    receiveOnly: false,
  },
  {
    id: 'wifi_calling',
    method: 'Wi-Fi calling',
    instruction: 'Call or text over any reachable Wi-Fi when the cellular side is down.',
    dependsOn: ['internet'],
    receiveOnly: false,
  },
  {
    id: 'landline_pots',
    method: 'Copper landline (POTS)',
    instruction: 'A copper POTS line is central-office battery-backed and often works in a blackout. VoIP/fiber landlines are not — they need power and internet.',
    dependsOn: ['landline'],
    receiveOnly: false,
  },
  {
    id: 'noaa_weather_radio',
    method: 'NOAA Weather Radio',
    instruction: 'Battery or hand-crank receiver for official alerts when all else is down (receive only).',
    dependsOn: ['battery'],
    receiveOnly: true,
    reference: 'NWR: 162.400 / 162.425 / 162.450 / 162.475 / 162.500 / 162.525 / 162.550 MHz',
  },
  {
    id: 'two_way_radio',
    method: 'Two-way radio (FRS/GMRS/ham)',
    instruction: 'Agree a channel and check-in time in advance; keep spare batteries charged.',
    dependsOn: ['battery'],
    receiveOnly: false,
    reference: 'FRS/GMRS calling — Channel 1 (462.5625 MHz)',
  },
  {
    id: 'physical_runner',
    method: 'In person',
    instruction: 'Go to the prearranged meeting point or check on people directly.',
    dependsOn: ['none'],
    receiveOnly: false,
  },
];

// ── Degradation model ────────────────────────────────────────────────────────
// Each step down the comms band assumes one more infrastructure tier is gone.
// A compromised power axis independently removes the mains. `battery` and `none`
// are never in the down-set — that is what guarantees a viable fallback.

function downDepsForBand(band: SurvivalBand): CommsDependency[] {
  switch (band) {
    case 'secure':
    case 'guarded': {
      return [];
    }
    case 'elevated': {
      return ['internet'];
    }
    case 'high': {
      return ['internet', 'cell_tower'];
    }
    case 'critical': {
      return ['internet', 'cell_tower', 'landline'];
    }
  }
}

function cadenceForBand(band: SurvivalBand): string {
  switch (band) {
    case 'secure':
    case 'guarded': {
      return 'Check in as needed';
    }
    case 'elevated': {
      return 'Check in every 4 hours';
    }
    case 'high': {
      return 'Check in every 2 hours';
    }
    case 'critical': {
      return 'Check in hourly, on the hour';
    }
  }
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

export function resolveCommsFallback(snapshot: WorldSnapshot): CommsFallbackPlan {
  const axes = snapshot.posture.axes;
  const commsLevel = clampLevel(axes.find((a) => a.axis === 'comms')?.level ?? 0);
  const powerLevel = clampLevel(axes.find((a) => a.axis === 'energy_water')?.level ?? 0);
  const commsBand = bandForLevel(commsLevel);
  const powerCompromised = powerLevel >= GUIDANCE_LEVEL;

  const down = new Set<CommsDependency>(downDepsForBand(commsBand));
  if (powerCompromised) down.add('mains_power');

  const ladder: CommsRung[] = LADDER.map((r) => ({
    id: r.id,
    method: r.method,
    instruction: r.instruction,
    dependsOn: [...r.dependsOn],
    offlineCapable: r.dependsOn.every((d) => d === 'battery' || d === 'none'),
    receiveOnly: r.receiveOnly,
    viable: r.dependsOn.every((d) => !down.has(d)),
    ...(r.reference === undefined ? {} : { reference: r.reference }),
  }));

  // Highest viable rung you can transmit on (never null — the runner rung is
  // always viable), and the highest viable receive channel separately.
  const recommended = ladder.find((r) => r.viable && !r.receiveOnly)!;
  const receiveRung = ladder.find((r) => r.viable && r.receiveOnly) ?? null;

  const checkIn: CommsCheckInProtocol = {
    outOfAreaContact: 'Designate one out-of-area contact everyone reaches separately — local circuits jam first.',
    meetingPoint: 'Agree a physical meeting point and a fallback time in case no channel works.',
    cadenceLabel: cadenceForBand(commsBand),
  };

  return {
    capturedAtMs: snapshot.capturedAtMs,
    commsLevel,
    commsBand,
    powerCompromised,
    ladder,
    recommendedRungId: recommended.id,
    receiveRungId: receiveRung ? receiveRung.id : null,
    checkIn,
    headline: buildHeadline(commsBand, recommended, powerCompromised),
  };
}

function buildHeadline(band: SurvivalBand, recommended: CommsRung, powerCompromised: boolean): string {
  const powerNote = powerCompromised ? ' with power down' : '';
  if (band === 'secure' || band === 'guarded') {
    return `Comms nominal${powerNote} — primary path: ${recommended.method}.`;
  }
  return `Comms ${band}${powerNote} — fall back to ${recommended.method}.`;
}
