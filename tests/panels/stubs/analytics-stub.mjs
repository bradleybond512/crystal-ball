/**
 * Test-time stub for src/services/analytics.ts. The real module pulls in
 * PostHog and reads `import.meta.env`. Panels only need the side-effect-free
 * track* helpers — return them as no-ops.
 */

const noop = () => {};
const noopAsync = async () => {};

export const hasAnalyticsConsent = () => false;
export const setAnalyticsConsent = noop;
export const initAnalytics = noopAsync;
export const trackEvent = noop;
export const trackEventBeforeUnload = noop;
export const trackPanelView = noop;
export const trackApiKeysSnapshot = noop;
export const trackLLMUsage = noop;
export const trackLLMFailure = noop;
export const trackPanelResized = noop;
export const trackVariantSwitch = noop;
export const trackMapLayerToggle = noop;
export const trackCountryBriefOpened = noop;
export const trackThemeChanged = noop;
export const trackLanguageChange = noop;
export const trackFeatureToggle = noop;
export const trackSearchUsed = noop;
export const trackMapViewChange = noop;
export const trackCountrySelected = noop;
export const trackSearchResultSelected = noop;
export const trackPanelToggled = noop;
export const trackFindingClicked = noop;
export const trackUpdateShown = noop;
export const trackUpdateClicked = noop;
export const trackUpdateDismissed = noop;
export const trackCriticalBannerAction = noop;
export const trackDownloadClicked = noop;
export const trackDownloadBannerDismissed = noop;
export const trackWebcamSelected = noop;
export const trackWebcamRegionFiltered = noop;
export const trackDeeplinkOpened = noop;
