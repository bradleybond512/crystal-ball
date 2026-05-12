import type { ScenarioFixture } from '../scenario-replay';
import { TORNADO_NEAR_HOME } from './tornado-near-home';
import { EARTHQUAKE_TSUNAMI } from './earthquake-tsunami';
import { WILDFIRE_AIR_QUALITY } from './wildfire-air-quality';
import { CYBER_INCIDENT } from './cyber-incident';
import { PORT_CLOSURE_SHORTAGE } from './port-closure-shortage';

export { TORNADO_NEAR_HOME } from './tornado-near-home';
export { EARTHQUAKE_TSUNAMI } from './earthquake-tsunami';
export { WILDFIRE_AIR_QUALITY } from './wildfire-air-quality';
export { CYBER_INCIDENT } from './cyber-incident';
export { PORT_CLOSURE_SHORTAGE } from './port-closure-shortage';

/** All built-in scenario fixtures in display order. */
export const BUILT_IN_SCENARIOS: readonly ScenarioFixture[] = [
  TORNADO_NEAR_HOME,
  EARTHQUAKE_TSUNAMI,
  WILDFIRE_AIR_QUALITY,
  CYBER_INCIDENT,
  PORT_CLOSURE_SHORTAGE,
] as const;
