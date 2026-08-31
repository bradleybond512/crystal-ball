import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPipelineTraceRegistry } from '../pipeline-trace.ts';
import {
  isWeatherNotificationLadderSeverity,
  weatherEvaluationTerminalEvent,
  weatherIngestionTerminalEvent,
  weatherOccurrenceTraceIds,
} from '../weather-pipeline-terminal.ts';

test('weather notification severity allowlist accepts only Extreme and Severe', () => {
  assert.equal(isWeatherNotificationLadderSeverity('Extreme'), true);
  assert.equal(isWeatherNotificationLadderSeverity('Severe'), true);
  assert.equal(isWeatherNotificationLadderSeverity('Moderate'), false);
  assert.equal(isWeatherNotificationLadderSeverity('Minor'), false);
  assert.equal(isWeatherNotificationLadderSeverity('Unknown'), false);
  assert.equal(isWeatherNotificationLadderSeverity('Emergency'), false);
  assert.equal(isWeatherNotificationLadderSeverity(undefined), false);
});

test('non-actionable and unrecognized weather severities terminate as dropped', () => {
  const severities = ['Moderate', 'Minor', 'Unknown', 'Emergency', undefined] as const;
  for (const [index, severity] of severities.entries()) {
    const traceId = `alert-${index}`;
    const registry = createPipelineTraceRegistry();
    registry.record(traceId, 'weather', { stage: 'ingested', at: 1000 });
    const terminal = weatherIngestionTerminalEvent(severity);
    assert.deepEqual(terminal, {
      stage: 'dropped',
      reason: 'below_notification_ladder_severity',
    });
    registry.record(traceId, 'weather', { ...terminal, at: 1001 });
    assert.deepEqual(registry.stalled(10_000, 5000), []);
  }
});

test('actionable weather severities remain open until the detector evaluates them', () => {
  for (const severity of ['Extreme', 'Severe'] as const) {
    const registry = createPipelineTraceRegistry();
    registry.record(severity, 'weather', { stage: 'ingested', at: 1000 });
    assert.equal(weatherIngestionTerminalEvent(severity), null);
    assert.deepEqual(registry.stalled(10_000, 5000).map((entry) => entry.traceId), [severity]);
  }
});

test('below-threshold evaluation terminates while a routing exception remains stalled', () => {
  const droppedRegistry = createPipelineTraceRegistry();
  droppedRegistry.record('below-threshold', 'weather', { stage: 'ingested', at: 1000 });
  droppedRegistry.record('below-threshold', 'weather', { stage: 'evaluated', at: 1001 });
  const dropped = weatherEvaluationTerminalEvent(false);
  assert.deepEqual(dropped, {
    stage: 'dropped',
    reason: 'big_event_threshold_not_met',
  });
  droppedRegistry.record('below-threshold', 'weather', { ...dropped, at: 1002 });
  assert.deepEqual(droppedRegistry.stalled(10_000, 5000), []);

  const routingFailureRegistry = createPipelineTraceRegistry();
  routingFailureRegistry.record('routing-failure', 'weather', { stage: 'ingested', at: 1000 });
  routingFailureRegistry.record('routing-failure', 'weather', { stage: 'evaluated', at: 1001 });
  assert.equal(weatherEvaluationTerminalEvent(true), null);
  assert.deepEqual(
    routingFailureRegistry.stalled(10_000, 5000).map((entry) => entry.traceId),
    ['routing-failure'],
  );
});

test('duplicate provider alert ids receive independent truthful trace lifecycles', () => {
  const [severeTraceId, moderateTraceId] = weatherOccurrenceTraceIds(['shared', 'shared']);
  assert.equal(severeTraceId, 'shared#occurrence-1');
  assert.equal(moderateTraceId, 'shared#occurrence-2');

  const registry = createPipelineTraceRegistry();
  registry.record(severeTraceId, 'weather', { stage: 'ingested', at: 1000 });
  registry.record(moderateTraceId, 'weather', { stage: 'ingested', at: 1000 });
  const moderateTerminal = weatherIngestionTerminalEvent('Moderate');
  assert.ok(moderateTerminal);
  registry.record(moderateTraceId, 'weather', { ...moderateTerminal, at: 1001 });
  registry.record(severeTraceId, 'weather', { stage: 'evaluated', at: 1002 });
  registry.record(severeTraceId, 'weather', { stage: 'routed', at: 1003 });

  assert.deepEqual(registry.get(severeTraceId)?.events.map((event) => event.stage), [
    'ingested',
    'evaluated',
    'routed',
  ]);
  assert.deepEqual(registry.get(moderateTraceId)?.events.map((event) => event.stage), [
    'ingested',
    'dropped',
  ]);
});

test('data-loader wires executable weather terminal decisions without closing its routing catch', () => {
  const source = readFileSync(new URL('../../../app/data-loader.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /const weatherTraceIds = weatherOccurrenceTraceIds\(alerts\.map\(\(alert\) => alert\.id\)\);/,
  );
  assert.match(
    source,
    /const traceId = weatherTraceIds\[index\] \?\? evt\.eventId;\s*ptr\.record\(traceId, 'weather', \{ stage: 'ingested' \}\);\s*const terminal = weatherIngestionTerminalEvent\(alerts\[index\]\?\.severity\);\s*if \(terminal\) ptr\.record\(traceId, 'weather', terminal\);/,
  );
  assert.match(
    source,
    /for \(const \{ alert, traceId \} of severeAlertEntries\)/,
  );
  assert.match(
    source,
    /const terminal = weatherEvaluationTerminalEvent\(bigEventResult\.isBigEvent\);\s*if \(terminal\) pipelineTrace\.record\(traceId, 'weather', terminal\);/,
  );
  assert.match(
    source,
    /pipelineTrace\.record\(traceId, 'weather', \{ stage: 'routed'/,
  );

  const catchStart = source.indexOf(
    "console.warn('[data-loader] weather alert routing failed for', alert.id, error);",
  );
  const catchEnd = source.indexOf('// Feed the title-bar status chip:', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart, 'weather routing catch must remain present');
  assert.doesNotMatch(source.slice(catchStart, catchEnd), /stage: '(?:routed|dropped)'/);
});
