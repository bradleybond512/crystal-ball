import { fileURLToPath } from 'node:url';
import { BEHAVIOR_SCENARIOS, runIsolatedFeedback } from '../tests/helpers/correlation-feedback-fixture.mts';

export function measureAlertFeedback() {
  const behavior = BEHAVIOR_SCENARIOS.map(scenario => runIsolatedFeedback({ scenario }));
  behavior.push(runIsolatedFeedback({ scenario: 'restart', storage: behavior.find(row => row.scenario === 'transitions').storage }));
  return {
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    limits: 'Synthetic real-store fixture; two observer subscribers. Callback counts are attributed separately. Wall time includes instrumentation and is not an app CPU or energy claim.',
    capacity: [0, 1, 500].map(transitions => runIsolatedFeedback({ scenario: 'capacity', transitions })),
    behavior,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(measureAlertFeedback(), null, 2));
