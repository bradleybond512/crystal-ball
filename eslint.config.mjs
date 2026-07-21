// @ts-check
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  // Block 1: Global ignores
  {
 ignores: [
 'node_modules/**',
 'dist/**',
 'src-tauri/target/**',
 '.agent/**',
 // Nested checkouts created by the git-worktree workflow live inside
 // `.worktrees/<name>/` (and historically `.claude/worktrees/<name>/`) and
 // contain a full copy of the tree. Linting them from the canonical repo
 // reports thousands of duplicate errors against unrelated branches.
 // NOTE: `**/worktrees/**` does NOT match `.worktrees/` — the leading dot is
 // a distinct path segment — so the `.worktrees/**` entry is required.
 '.worktrees/**',
 '.claude/worktrees/**',
 '**/worktrees/**',
 'src/workers/ml.worker.ts',
 'src/generated/**',
 'convex/**',
 'api/\\[domain\\]/**', // esbuild artifact — not source; brackets escaped to prevent glob char-class interpretation
 ],
  },

  // Block 2: TypeScript source — full type-checked rules
  {
 files: ['src/**/*.ts'],
 ignores: ['src/**/__tests__/**'],
 extends: [
 ...tseslint.configs.recommendedTypeChecked,
 ...tseslint.configs.stylisticTypeChecked,
 ],
 plugins: {
 unicorn,
 sonarjs,
 },
 languageOptions: {
 parserOptions: {
 projectService: true,
 tsconfigRootDir: import.meta.dirname,
 },
 },
 rules: {
 '@typescript-eslint/no-floating-promises': 'error',
 '@typescript-eslint/no-explicit-any': 'error',
 '@typescript-eslint/no-misused-promises': 'error',
 'no-console': 'error',
 'no-restricted-syntax': [
 'error',
 {
 selector: 'Literal[value=/localhost/]',
 message: 'Use 127.0.0.1 instead of localhost — WKWebView treats them as distinct origins.',
 },
 {
 selector: 'FunctionDeclaration[id.name=/^(escapeHtml|safeHtml|sanitizeHtml)$/]',
 message: 'Do not reimplement HTML escaping locally — import escapeHtml from @/utils/sanitize (or sanitizeHtml from @/utils/safe-html for DOMPurify-backed rich HTML). Local reimplementations drift out of sync and have shipped with missing escape characters (SEC-007).',
 },
 {
 selector: 'VariableDeclarator[id.name=/^(escapeHtml|safeHtml|sanitizeHtml)$/]',
 message: 'Do not reimplement HTML escaping locally — import escapeHtml from @/utils/sanitize (or sanitizeHtml from @/utils/safe-html for DOMPurify-backed rich HTML). Local reimplementations drift out of sync and have shipped with missing escape characters (SEC-007).',
 },
 ],
 // TODO: add a `no-unsafe-innerHTML` rule once the 125 existing
 // template-literal innerHTML sites have been audited and tagged with
 // `// safe-html: …` justification comments. Rule design:
 //   AssignmentExpression[left.property.name="innerHTML"][right.type="TemplateLiteral"]
 // Security reviews have already verified the current sites escape user data
 // via escapeHtml()/sanitizeUrl() or interpolate only translation keys; the
 // rule is valuable for future regressions, not current XSS hunting.
 ...unicorn.configs.recommended.rules,
 ...sonarjs.configs.recommended.rules,
 // Unicorn overrides — codebase conventions
 'unicorn/prevent-abbreviations': 'off',
 'unicorn/no-array-reduce': 'off',
 'unicorn/filename-case': 'off',
 // ES version / type-safety overrides (unsafe to auto-fix with TS6)
 'unicorn/prefer-query-selector': 'off', // querySelector returns Element, not HTMLElement
 'unicorn/prefer-string-replace-all': 'off', // replaceAll requires ES2021
 'unicorn/prefer-at': 'off', // .at() requires ES2022
 'unicorn/prefer-dom-node-dataset': 'off', // dataset missing on Element, only on HTMLElement
 'unicorn/prefer-native-coercion-functions': 'off', // strips TS type-guard predicates in .filter()
 'unicorn/prefer-switch': 'off', // introduces case values absent from union types
 'unicorn/prefer-array-find': 'off', // checkFromLast introduces findLast (ES2023)
 'unicorn/explicit-length-check': 'off', // > 0 breaks string-length truthiness checks
 'unicorn/no-useless-undefined': 'off', // removes .reduce() initial value, breaking TS inference
 'unicorn/prefer-global-this': 'off', // globalThis lacks window index signature for YT API
 'unicorn/no-array-for-each': 'off', // for..of on optional-chained NodeList → TS undefined error
 '@typescript-eslint/no-unnecessary-type-assertion': 'off', // removes Element→HTMLElement casts downstream code requires
 '@typescript-eslint/non-nullable-type-assertion-style': 'off', // converts `as T` to `!`, losing type narrowing
 'unicorn/no-null': 'off', // codebase convention: null used for nullable DOM/library values
 'unicorn/no-array-sort': 'off', // Array#toSorted requires ES2022; tsconfig targets ES2020
 'unicorn/no-array-reverse': 'off', // Array#toReversed() requires ES2023; tsconfig targets ES2020
 },
  },

  // Block 2b: the canonical HTML-escaping/sanitizing modules ARE the
  // implementation, so they are exempt from the no-local-reimplementation guard
  // above (dom-utils' safeHtml returns a sanitized DocumentFragment — a distinct
  // DOM-level utility, not a string escaper).
  {
 files: ['src/utils/sanitize.ts', 'src/utils/dom-utils.ts', 'src/utils/safe-html.ts'],
 rules: {
 'no-restricted-syntax': [
 'error',
 {
 selector: 'Literal[value=/localhost/]',
 message: 'Use 127.0.0.1 instead of localhost — WKWebView treats them as distinct origins.',
 },
 ],
 },
  },

  // Block 3: Sidecar + scripts — no type-checking
  {
 files: [
 'src-tauri/sidecar/**/*.mjs',
 'scripts/**/*.mjs',
 'api/**/*.js',
 ],
 extends: [
 ...tseslint.configs.recommended,
 ],
 plugins: {
 unicorn,
 sonarjs,
 },
 rules: {
 'no-console': 'off',
 'no-restricted-syntax': [
 'error',
 {
 selector: 'Literal[value=/localhost/]',
 message: 'Use 127.0.0.1 instead of localhost — WKWebView treats them as distinct origins.',
 },
 ],
 ...unicorn.configs.recommended.rules,
 ...sonarjs.configs.recommended.rules,
 'unicorn/prevent-abbreviations': 'off',
 'unicorn/no-array-reduce': 'off',
 'unicorn/filename-case': 'off',
 'unicorn/prefer-string-replace-all': 'off', // replaceAll requires ES2021
 'unicorn/prefer-at': 'off', // .at() requires ES2022
 'unicorn/prefer-array-find': 'off', // findLast requires ES2023
 'unicorn/prefer-switch': 'off', // can expose invalid case values
 'unicorn/explicit-length-check': 'off', // > 0 breaks truthiness checks on non-number types
 'unicorn/no-useless-undefined': 'off', // removes .reduce() initial value
 'unicorn/no-null': 'off', // codebase convention: null used for nullable values
 'unicorn/no-array-sort': 'off', // Array#toSorted requires ES2022
 },
  },

  // Block 4: Test files — relaxed rules
  {
 files: ['**/*.test.*', 'e2e/**'],
 plugins: {
 unicorn,
 sonarjs,
 },
 rules: {
 'no-console': 'off',
 'sonarjs/cognitive-complexity': 'off',
 'unicorn/no-process-exit': 'off',
 },
  },

  // Block 4b: TypeScript test files (.test.ts / .test.mts) — use the
  // TypeScript parser but skip the typed-checked rules that require
  // tsconfig.json membership (test files are excluded from tsconfig).
  {
 files: [
 'src/**/__tests__/**/*.ts', 'src/**/__tests__/**/*.mts',
 'src/**/*.test.ts', 'src/**/*.test.mts',
 // tests/ directory at the repo root (e.g. tests/panels/ smoke
 // harness) — same TS parser, no tsconfig membership required.
 'tests/**/*.ts', 'tests/**/*.mts',
 ],
 languageOptions: {
 parser: tseslint.parser,
 parserOptions: { sourceType: 'module' },
 },
  },

  // Block 5: Legacy large files — written before ESLint was added.
  // New files must be fully compliant; these are grandfathered.
  {
 files: [
 'src/app/data-loader.ts',
 'src/app/panel-layout.ts',
 'src/app/event-handlers.ts',
 'src/config/panels.ts',
 'src/components/Map.ts',
 'src/components/DeckGLMap.ts',
 'src-tauri/sidecar/local-api-server.mjs',
 'src/services/runtime.ts',
 'src/components/GodsVisionView.ts',
 'src/types/index.ts',
 'src/types/**/*.ts',
 'src/config/variants/**/*.ts',
 'src/e2e/**/*.ts',
 'src/components/EvacuationPanel.ts',
 'src/components/FamilyTrackerPanel.ts',
 'src/components/OfflineMapPanel.ts',
 'src/components/PowerGridPanel.ts',
 'src/components/StalenessBanner.ts',
 'src/components/ResourceInventoryPanel.ts',
 'src/services/evacuation-router.ts',
 'src/services/family-tracker.ts',
 'src/services/offline-map-cache.ts',
 'src/services/power-grid.ts',
 'src/services/data-freshness.ts',
 'src/services/alert-normalizer.ts',
 'src/services/offline-alert-cache.ts',
 'src/services/unified-alerts.ts',
 'src/App.ts',
 'src/bootstrap/chunk-reload.ts',
 'src/services/intelligence-briefing.ts',
 'src/components/IntelligenceBriefingPanel.ts',
 'src/services/crystal-ball-chat.ts',
 'src/components/AskCrystalBallPanel.ts',
 'src/services/survival-advisor.ts',
 'src/components/SurvivalAdvisorPanel.ts',
 'src/services/threat-synthesis.ts',
 'src/components/ThreatSynthesisPanel.ts',
 'src/services/scenario-simulator.ts',
 'src/components/ScenarioSimulatorPanel.ts',
 'src/services/escalation-forecast.ts',
 'src/components/EscalationForecastPanel.ts',
 'src/services/anomaly-detection.ts',
 'src/components/AnomalyDetectionPanel.ts',
 'src/services/financial-contagion.ts',
 'src/components/FinancialContagionPanel.ts',
 'src/services/supply-chain-impact.ts',
 'src/components/SupplyChainImpactPanel.ts',
 'src/services/water-quality.ts',
 'src/components/WaterQualityPanel.ts',
 'src/services/nuclear-monitor.ts',
 'src/components/NuclearMonitorPanel.ts',
 'src/services/notification-digest.ts',
 'src/components/NotificationDigestPanel.ts',
 'src/components/location-gate.ts',
 'src/components/ClaudeAgentPanel.ts',
 'src/components/EconomicPanel.ts',
 'src/components/EconomicStressPanel.ts',
 'src/components/TradePolicyPanel.ts',
 'src/components/SupplyChainPanel.ts',
 'src/components/ThreatIntelHubPanel.ts',
 'src/components/GeoIntelPanel.ts',
 'src/components/AirstrikesPanel.ts',
 'src/components/HazardAlertsPanel.ts',
 'src/components/LiveNewsPanel.ts',
 'src/services/sigint-convergence.ts',
 'src/services/pattern-of-life.ts',
 'src/services/dark-vessel.ts',
 'src/services/course-of-action.ts',
 'src/services/theater-polygons.ts',
 'src/services/threat-convergence.ts',
 'src/components/PatternOfLifePanel.ts',
 'src/components/SigintPanel.ts',
 'src/components/DarkVesselPanel.ts',
 'src/components/CourseOfActionPanel.ts',
 'src/components/KillChainPanel.ts',
 'src/components/IcsOtDashboardPanel.ts',
 'src/components/IocManagerPanel.ts',
 'src/components/OrbatPanel.ts',
 'src/components/AarPanel.ts',
 'src/components/NetworkTopologyPanel.ts',
 'src/components/GeofencePanel.ts',
 'src/components/StixTaxiiPanel.ts',
 'src/services/kill-chain.ts',
 'src/services/ics-ot-monitor.ts',
 'src/services/ioc-manager.ts',
 'src/services/orbat.ts',
 'src/services/after-action-review.ts',
 'src/services/custom-geofence.ts',
 'src/services/network-topology.ts',
 'src/services/stix-taxii.ts',
 'src/services/intel-pipeline.ts',
 'src/services/entity-link-graph.ts',
 'src/services/timeline-scrubber.ts',
 'src/services/intel-report.ts',
 'src/services/sanctions-crossref.ts',
 'src/services/compound-threat-detector.ts',
 'src/services/correlation-matrix.ts',
 'src/services/cascade-simulator.ts',
 'src/services/emergency-broadcast.ts',
 'src/services/satellite-change.ts',
 'src/components/EntityLinkGraphPanel.ts',
 'src/components/TimelineScrubberPanel.ts',
 'src/components/IntelReportPanel.ts',
 'src/components/SanctionsCrossRefPanel.ts',
 'src/components/CompoundThreatPanel.ts',
 'src/components/CorrelationMatrixPanel.ts',
 'src/components/CascadeSimulatorPanel.ts',
 'src/components/EmergencyBroadcastPanel.ts',
 'src/components/SatelliteChangePanel.ts',
 ],
 plugins: {
 unicorn,
 sonarjs,
 },
 rules: {
 'no-console': 'off',
 '@typescript-eslint/no-floating-promises': 'off',
 '@typescript-eslint/no-unsafe-member-access': 'off',
 '@typescript-eslint/no-unsafe-assignment': 'off',
 '@typescript-eslint/no-unsafe-call': 'off',
 '@typescript-eslint/no-explicit-any': 'off',
 '@typescript-eslint/no-empty-function': 'off',
 '@typescript-eslint/dot-notation': 'off',
 '@typescript-eslint/prefer-nullish-coalescing': 'off',
 'unicorn/prefer-single-call': 'off',
 'unicorn/no-zero-fractions': 'off',
 'unicorn/no-array-callback-reference': 'off',
 'sonarjs/cognitive-complexity': 'off',
 'sonarjs/no-nested-conditional': 'off',
 'sonarjs/void-use': 'off',
 'sonarjs/no-try-promise': 'off',
 'sonarjs/no-nested-template-literals': 'off',
 'sonarjs/no-all-duplicated-branches': 'off',
 'unicorn/no-nested-ternary': 'off',
 'unicorn/consistent-function-scoping': 'off',
 'unicorn/prefer-spread': 'off',
 'unicorn/prefer-dom-node-append': 'off',
 'unicorn/numeric-separators-style': 'off',
 'unicorn/no-negated-condition': 'off',
 'unicorn/no-immediate-mutation': 'off',
 '@typescript-eslint/require-await': 'off',
 '@typescript-eslint/no-misused-promises': 'off',
 '@typescript-eslint/no-unsafe-argument': 'off',
 '@typescript-eslint/no-unsafe-return': 'off',
 '@typescript-eslint/array-type': 'off',
 'sonarjs/deprecation': 'off',
 'sonarjs/use-type-alias': 'off',
 'sonarjs/no-hardcoded-ip': 'off',
 'sonarjs/no-nested-functions': 'off',
 'sonarjs/no-unused-vars': 'off',
 'sonarjs/no-dead-store': 'off',
 'sonarjs/no-alphabetical-sort': 'off',
 'sonarjs/max-switch-cases': 'off',
 '@typescript-eslint/no-base-to-string': 'off',
 '@typescript-eslint/no-unused-vars': 'off',
 'unicorn/prefer-number-properties': 'off',
 'unicorn/prefer-add-event-listener': 'off',
 '@typescript-eslint/prefer-promise-reject-errors': 'off',
 'sonarjs/no-redundant-jump': 'off',
 'sonarjs/pseudo-random': 'off',
 'sonarjs/no-intrusive-permissions': 'off',
 'sonarjs/no-async-constructor': 'off',
 'unicorn/prefer-blob-reading-methods': 'off',
 'unicorn/prefer-array-some': 'off',
 '@typescript-eslint/restrict-plus-operands': 'off',
 '@typescript-eslint/no-unused-vars': 'off',
 'sonarjs/slow-regex': 'off',
 'sonarjs/no-clear-text-protocols': 'off',
 'sonarjs/no-gratuitous-expressions': 'off',
 'no-restricted-syntax': 'off',
 'unicorn/text-encoding-identifier-case': 'off',
 'unicorn/no-array-reverse': 'off',
 'sonarjs/no-misleading-array-reverse': 'off',
 'sonarjs/different-types-comparison': 'off',
 'sonarjs/link-with-target-blank': 'off',
 'prefer-const': 'off',
 'unicorn/switch-case-braces': 'off',
 'unicorn/prefer-string-raw': 'off',
 'unicorn/no-useless-fallback-in-spread': 'off',
 'unicorn/number-literal-case': 'off',
 '@typescript-eslint/prefer-optional-chain': 'off',
 },
  },
);
