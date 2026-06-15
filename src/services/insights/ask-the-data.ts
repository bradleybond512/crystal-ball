/**
 * Ask-The-Data structured query — gap #5 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Deterministic retrieval over Crystal Ball's normalized state
 * (features, panels, providers, missions, evaluations, fixtures).
 * The host calls `answer(question, context)` and gets back a
 * structured packet: matched intent, evidence rows, plain-English
 * answer, and follow-up questions. LLM prose is optional — the
 * grounded answer packet is always produced first.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import type { FeatureHealth, PanelHealth } from '@/services/diagnostics/system-health-types';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import type { MissionRecord } from '@/services/ops/mission-types';
import { semanticFallback } from '@/services/cognition/semantic-ask';

// ── Public API ──────────────────────────────────────────────────────────

export type QuestionIntent =
  | 'why_high_risk'
  | 'what_changed'
  | 'who_disagrees'
  | 'what_raises_confidence'
  | 'what_to_watch'
  | 'late_warning'
  | 'unknown';

export interface AskContext {
  features: readonly FeatureHealth[];
  panels: readonly PanelHealth[];
  algorithms?: readonly AlgorithmHealth[];
  missions?: readonly MissionRecord[];
  /** Optional generated-at timestamp. Defaults to Date.now(). */
  generatedAt?: number;
}

export interface EvidenceRow {
  /** Stable id ("feature:weather_warning", "mission:fixture-late-severe-wind"). */
  id: string;
  label: string;
  /** Free-text fact. */
  fact: string;
  /** Optional 0..1 confidence the host attaches. */
  confidence?: number;
}

export interface AnswerPacket {
  question: string;
  intent: QuestionIntent;
  /** Plain-English deterministic answer. The host can pipe through an
   *  LLM later for prose, but this string alone is meant to be
   *  understandable. */
  answer: string;
  evidence: readonly EvidenceRow[];
  /** Concrete follow-up questions the user can ask next. */
  followUps: readonly string[];
}

// ── Intent classification ──────────────────────────────────────────────

const INTENT_PATTERNS: { intent: QuestionIntent; patterns: RegExp[] }[] = [
  {
    intent: 'why_high_risk',
    patterns: [/why .* (high|elevated|critical|risk|severe)/i, /what.*driving/i, /why.*alert/i],
  },
  {
    intent: 'what_changed',
    patterns: [/what changed/i, /changes? since/i, /diff(?:erent)? (?:from|since)/i],
  },
  {
    intent: 'who_disagrees',
    patterns: [/which sources? disagree/i, /who.*disagree/i, /sources?.*conflict/i, /contradict/i],
  },
  {
    intent: 'what_raises_confidence',
    patterns: [/raise confidence/i, /improve confidence/i, /what would (?:make|raise)/i, /increase certainty/i],
  },
  {
    intent: 'what_to_watch',
    patterns: [/what (?:should|to) (?:i )?watch/i, /watch (?:next|for)/i, /next (?:indicators?|signals?)/i],
  },
  {
    intent: 'late_warning',
    patterns: [/warn(?:ing)? late/i, /miss(?:ed)? (?:warning|alert)/i, /why.*didn'?t.*get warned/i],
  },
];

export function classifyIntent(question: string): QuestionIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(question))) return intent;
  }
  return 'unknown';
}

// ── Answerer ───────────────────────────────────────────────────────────

export function answer(question: string, context: AskContext): AnswerPacket {
  const intent = classifyIntent(question);
  switch (intent) {
    case 'why_high_risk': {
      return answerWhyHighRisk(question, context);
    }
    case 'what_changed': {
      return answerWhatChanged(question, context);
    }
    case 'who_disagrees': {
      return answerWhoDisagrees(question, context);
    }
    case 'what_raises_confidence': {
      return answerWhatRaisesConfidence(question, context);
    }
    case 'what_to_watch': {
      return answerWhatToWatch(question, context);
    }
    case 'late_warning': {
      return answerLateWarning(question, context);
    }
    case 'unknown': {
      return semanticFallback(question) ?? answerUnknown(question);
    }
  }
}

function answerWhyHighRisk(question: string, context: AskContext): AnswerPacket {
  const concerning = [...context.features]
    .filter((f) => f.status !== 'healthy' && f.status !== 'unknown')
    .sort((a, b) => severityRank(b.status) - severityRank(a.status));
  if (concerning.length === 0) {
    return {
      question,
      intent: 'why_high_risk',
      answer: 'No features are reporting elevated risk right now. Risk is calm.',
      evidence: [],
      followUps: ['What changed since yesterday?', 'What should I watch next?'],
    };
  }
  const top = concerning.slice(0, 3);
  const evidence: EvidenceRow[] = top.map((f) => {
    const impactSuffix = f.userImpact ? ` Impact: ${f.userImpact}` : '';
    return {
      id: `feature:${f.featureId}`,
      label: f.label,
      fact: `${f.status.toUpperCase()} — ${f.reason}${impactSuffix}`,
      confidence: f.confidenceMultiplier,
    };
  });
  const headline = top.map((f) => `${f.label} (${f.status})`).join(', ');
  return {
    question,
    intent: 'why_high_risk',
    answer: `Risk is elevated because ${top.length} feature${top.length === 1 ? ' is' : 's are'} below their calibration floor: ${headline}.`,
    evidence,
    followUps: [
      'What would raise confidence?',
      'Which sources disagree?',
      'Did we warn late last time?',
    ],
  };
}

function answerWhatChanged(question: string, context: AskContext): AnswerPacket {
  const driftingPanels = context.panels.filter((p) => p.status === 'stale' || p.status === 'failing');
  const evidence: EvidenceRow[] = driftingPanels.slice(0, 5).map((p) => ({
    id: `panel:${p.panelId}`,
    label: p.label ?? p.panelId,
    fact: `${p.status.toUpperCase()} — ${p.lastError ?? 'no error reported'}.`,
  }));
  const summary = driftingPanels.length === 0
    ? 'No panels have drifted since the last check.'
    : `${driftingPanels.length} ${plural(driftingPanels.length, 'panel')} drifted since the last check.`;
  return {
    question,
    intent: 'what_changed',
    answer: summary,
    evidence,
    followUps: ['Why is risk high?', 'What should I watch next?'],
  };
}

function answerWhoDisagrees(question: string, context: AskContext): AnswerPacket {
  // Without provider snapshots wired in we surface the panels with
  // explicit lastError as proxy disagreement.
  const conflicted = context.panels.filter((p) => !!p.lastError);
  return {
    question,
    intent: 'who_disagrees',
    answer: conflicted.length === 0
      ? 'No panels are reporting source conflicts right now.'
      : `${conflicted.length} ${plural(conflicted.length, 'panel')} reporting source conflicts.`,
    evidence: conflicted.slice(0, 5).map((p) => ({
      id: `panel:${p.panelId}`,
      label: p.label ?? p.panelId,
      fact: p.lastError ?? 'unspecified conflict',
    })),
    followUps: ['Why is risk high?', 'What would raise confidence?'],
  };
}

function answerWhatRaisesConfidence(question: string, context: AskContext): AnswerPacket {
  const sub50 = (context.algorithms ?? [])
    .filter((a) => a.status === 'degraded' || a.status === 'failing' || a.status === 'unsafe')
    .sort((a, b) => severityRankAlgorithm(b.status) - severityRankAlgorithm(a.status));
  const evidence: EvidenceRow[] = sub50.slice(0, 4).map((a) => ({
    id: `algorithm:${a.algorithmId}`,
    label: a.label,
    fact: a.recommendedAdjustment || a.reason,
  }));
  return {
    question,
    intent: 'what_raises_confidence',
    answer: sub50.length === 0
      ? 'All algorithms are within their calibration floors. Confidence is as high as the data layer allows.'
      : `Confidence would rise if these ${sub50.length} ${plural(sub50.length, 'algorithm')} got a calibration update.`,
    evidence,
    followUps: ['Why is risk high?', 'Did we warn late last time?'],
  };
}

function answerWhatToWatch(question: string, context: AskContext): AnswerPacket {
  const concerning = [...context.features]
    .filter((f) => f.status === 'degraded' || f.status === 'stale' || f.status === 'blind')
    .sort((a, b) => severityRank(b.status) - severityRank(a.status));
  const evidence: EvidenceRow[] = concerning.slice(0, 4).map((f) => ({
    id: `feature:${f.featureId}`,
    label: f.label,
    fact: f.recommendedAction || f.reason,
  }));
  return {
    question,
    intent: 'what_to_watch',
    answer: concerning.length === 0
      ? 'Nothing is flagged as drifting. Watch the Command Center for the next refresh.'
      : `Watch ${concerning.length} ${plural(concerning.length, 'feature')} for the next refresh window.`,
    evidence,
    followUps: ['Why is risk high?', 'What changed since yesterday?'],
  };
}

function answerLateWarning(question: string, context: AskContext): AnswerPacket {
  const missions = context.missions ?? [];
  const lateOrMissed = missions.filter((m) => m.status === 'resolved_miss' || hasLateWarning(m));
  const evidence: EvidenceRow[] = lateOrMissed.slice(0, 5).map((m) => ({
    id: `mission:${m.id}`,
    label: m.description,
    fact: m.status === 'resolved_miss' ? 'Resolved as a miss.' : 'Warning fired after impact.',
  }));
  return {
    question,
    intent: 'late_warning',
    answer: lateOrMissed.length === 0
      ? 'No missions are flagged as late or missed in the current window.'
      : `${lateOrMissed.length} ${plural(lateOrMissed.length, 'mission')} flagged as late or missed.`,
    evidence,
    followUps: ['What would raise confidence?', 'Which sources disagree?'],
  };
}

function answerUnknown(question: string): AnswerPacket {
  return {
    question,
    intent: 'unknown',
    answer: 'I don\'t recognise that question yet. Try one of the follow-ups below.',
    evidence: [],
    followUps: [
      'Why is risk high?',
      'What changed since yesterday?',
      'Which sources disagree?',
      'What would raise confidence?',
      'What should I watch next?',
      'Did we warn late last time?',
    ],
  };
}

function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function severityRank(status: FeatureHealth['status']): number {
  switch (status) {
    case 'healthy':
    case 'unknown': {
      return 0;
    }
    case 'degraded': {
      return 1;
    }
    case 'stale': {
      return 2;
    }
    case 'blind': {
      return 3;
    }
    case 'failing': {
      return 4;
    }
    case 'unsafe': {
      return 5;
    }
  }
}

function severityRankAlgorithm(status: AlgorithmHealth['status']): number {
  switch (status) {
    case 'healthy':
    case 'unknown': {
      return 0;
    }
    case 'degraded': {
      return 1;
    }
    case 'failing': {
      return 2;
    }
    case 'unsafe': {
      return 3;
    }
  }
}

function hasLateWarning(m: MissionRecord): boolean {
  let warning: number | undefined;
  let impact: number | undefined;
  for (const e of m.events) {
    if (e.kind === 'user_notified' && (warning === undefined || e.at < warning)) warning = e.at;
    if (e.kind === 'actual_impact' && (impact === undefined || e.at < impact)) impact = e.at;
  }
  return warning !== undefined && impact !== undefined && warning > impact;
}
