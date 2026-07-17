import type { SurvivalGuide } from '../guide-types';

export const WILDFIRE_SMOKE_GUIDE: SurvivalGuide = {
  id: 'wildfire_smoke',
  kind: 'hazard',
  title: 'Wildfire Smoke',
  summary:
    'Fine particulate matter (PM2.5) from wildfire smoke can travel hundreds of miles and ' +
    'harm the heart and lungs even when the fire itself is far away and poses no direct ' +
    'threat. The people most at risk are those with asthma or heart disease, children, ' +
    'the elderly, and pregnant people. A properly rated mask and a clean-air room at home ' +
    'meaningfully cut exposure.',
  signs: [
    'AirNow AQI in the Unhealthy for Sensitive Groups range (101+) or higher for your area',
    'Visible haze, a smoky smell, or reduced visibility with no local fire',
    'Local air-quality alert or smoke advisory issued for your region',
    'Eye irritation, coughing, or shortness of breath outdoors that eases indoors',
  ],
  prepare: [
    { label: 'Set up a HEPA filter or box-fan filter for a clean-air room', detail: 'A HEPA air purifier, or a box fan with a MERV-13 filter taped to the intake, meaningfully cuts indoor PM2.5.' },
    { label: 'Stock N95 masks, not cloth or surgical masks', detail: 'Only N95/KN95-rated masks filter the fine particulate in smoke; cloth masks do not.' },
    { label: 'Bookmark a reliable AQI source', detail: 'AirNow.gov gives real-time, location-based air quality so you can decide when to limit outdoor time.' },
    { label: 'Pick your clean-air room in advance', detail: 'A smaller interior room with few windows/doors is easiest to seal and filter effectively.' },
  ],
  during: [
    { label: 'Check the AQI before going outside and limit exertion when it\'s high', detail: 'Even people without existing conditions should reduce prolonged or heavy outdoor exertion above AQI 150.' },
    { label: 'Stay in a clean-air room with windows and doors closed', detail: 'Run a HEPA purifier or filtered box fan continuously; avoid activities that add indoor particulates (frying, candles, smoking).' },
    { label: 'Wear a properly fitted N95 if you must go outside', detail: 'It should seal against the face with no gaps — facial hair and loose fit both reduce effectiveness.' },
    { label: 'Watch vulnerable household members closely', detail: 'Anyone with asthma, COPD, or heart disease should have their action plan and rescue medication on hand.' },
  ],
  after: [
    { label: 'Continue monitoring AQI until it returns to good/moderate', detail: 'Smoke can linger for days after a fire is contained, especially with the wrong wind pattern.' },
    { label: 'Ventilate the home once outdoor air quality improves', detail: 'Open windows to clear out indoor particulate buildup, then close up again if smoke returns.' },
    { label: 'Replace air filters that were heavily used during the smoke event', detail: 'Clogged filters lose effectiveness and should be swapped after extended heavy use.' },
  ],
  recovery: [
    'Anyone with new or worsening respiratory symptoms after a smoke event should see a doctor.',
    'Clean surfaces that collected ash or particulate residue during the event.',
    'Reassess your clean-air room setup for the next smoke season.',
  ],
  mistakes: [
    'Wearing a cloth or surgical mask and assuming it filters smoke particulate — it does not.',
    'Exercising or doing yard work outdoors during a high-AQI day.',
    'Ignoring smoke because "the fire is far away" — PM2.5 travels hundreds of miles.',
    'Running the AC on the "fresh air intake" setting during a smoke event instead of recirculate.',
  ],
  checklist: [
    { id: 'wildfire_smoke.hepa', label: 'HEPA purifier or box-fan filter ready', weight: 3 },
    { id: 'wildfire_smoke.n95', label: 'N95 masks on hand', weight: 2 },
    { id: 'wildfire_smoke.aqi_source', label: 'AQI source (AirNow) bookmarked', weight: 2 },
    { id: 'wildfire_smoke.clean_room', label: 'Clean-air room chosen', weight: 2 },
  ],
  relatedGuides: ['wildfire', 'shelter_in_place'],
  sources: ['AirNow.gov', 'CDC — Wildfire Smoke and Your Health', 'EPA — Smoke-Ready Toolbox'],
};
