import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const REQUIRED_TOKENS = [
  '--ux025-canvas',
  '--ux025-solid-1',
  '--ux025-solid-2',
  '--ux025-solid-3',
  '--ux025-chrome-bg',
  '--ux025-raised-bg',
  '--ux025-chrome-fallback',
  '--ux025-raised-fallback',
  '--ux025-blur-chrome',
  '--ux025-blur-raised',
  '--ux025-edge-specular',
  '--ux025-edge-perimeter',
  '--ux025-control-press-scale',
] as const;

const PROTECTED_TOKEN_LINES = [
  '--severity-critical: #dc2626;',
  '--severity-high:     #ea580c;',
  '--status-ok:    #4caf50;',
  '--status-error: #ff453a;',
  '--hs-bg-base:   #0b0d12;',
  '--hs-bg-card:   #0b0f14;',
  '--hs-bg-ribbon: #090d12;',
  '--mat-chrome-bg: rgba(24, 28, 36, 0.55);',
  '--mat-raised-bg: rgba(25, 29, 37, 0.62);',
  '--mat-blur-chrome: blur(22px) saturate(1.5);',
  '--mat-blur-raised: blur(24px) saturate(1.5);',
] as const;

test('UX-025 exposes a Full-dark-desktop-only material token interface', () => {
  const css = read('src/styles/tokens.css');
  for (const token of REQUIRED_TOKENS) {
    assert.match(css, new RegExp(`${token.replaceAll('-', '\\-')}\\s*:`), `${token} is missing`);
  }
  assert.match(
    css,
    /:root\[data-theme=["']dark["']\][^{]*:not\(\[data-variant=["']tech["']\]\)[^{]*:not\(\[data-variant=["']finance["']\]\)[^{]*:not\(\[data-variant=["']happy["']\]\)[^{]*body\.is-desktop-macos\s*\{/s,
    'the UX-025 interface must be gated to Full dark desktop',
  );
});

test('UX-025 keeps smoked chrome inside the approved diffusion bounds', () => {
  const css = read('src/styles/tokens.css');
  const alpha = Number(css.match(/--ux025-chrome-bg:\s*rgba\([^;]+,\s*([\d.]+)\)/)?.[1]);
  assert.ok(alpha >= 0.72 && alpha <= 0.8, `chrome alpha ${alpha} is outside 0.72–0.80`);
  for (const material of ['chrome', 'raised']) {
    const saturation = Number(css.match(new RegExp(`--ux025-blur-${material}:\\s*blur\\([^;]+?saturate\\(([\\d.]+)\\)`))?.[1]);
    assert.ok(saturation >= 1.05 && saturation <= 1.2, `${material} saturation ${saturation} is outside 1.05–1.20`);
  }
});

test('Home production renderer owns one intelligence-island wrapper', () => {
  const source = read('src/components/HomeShellOverlay.ts');
  const css = read('src/styles/home-shell.css');
  assert.equal((source.match(/home-shell-intel-island/g) ?? []).length, 1);
  assert.match(css, /\.home-shell-intel-island\s*\{/);
});

test('Home intelligence island uses concentric outer and inner geometry', () => {
  const css = read('src/styles/home-shell.css');
  assert.match(css, /\.home-shell-intel-island\s*\{[^{}]*border-radius\s*:\s*var\(--r-xl\)/s);
  assert.match(
    css,
    /body\.is-desktop-macos \.home-shell-readiness,\s*:root[^{}]*body\.is-desktop-macos \.hs-band\s*\{[^{}]*border-radius\s*:\s*var\(--r-md\)/s,
  );
});

test('classic desktop assigns smoked chrome only to sidebar and toolbar while panels stay solid', () => {
  const nativeCss = read('src/styles/macos-native.css');
  for (const selector of ['mac-sidebar', 'mac-content-toolbar']) {
    const rule = new RegExp(`\\.${selector}[^{}]*\\{[^{}]*background\\s*:\\s*var\\(--ux025-chrome-bg\\)[^{}]*backdrop-filter\\s*:\\s*var\\(--ux025-blur-chrome\\)`, 's');
    assert.match(nativeCss, rule, `${selector} must own the classic smoked chrome`);
  }
  for (const selector of ['.panels-grid .panel', '.panels-grid .panel-content']) {
    const blocks = [...nativeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const block = blocks.find(([, selectors]) => selectors.split(',').some((entry) => entry.trim().endsWith(selector)));
    assert.ok(block, `missing ${selector} classic surface rule`);
    assert.match(block[1], /:root\[data-theme=["']dark["']\][\s\S]*:not\(\[data-variant=["']tech["']\]\)[\s\S]*:not\(\[data-variant=["']finance["']\]\)[\s\S]*:not\(\[data-variant=["']happy["']\]\)[\s\S]*body\.is-desktop-macos/);
    assert.match(block[2], /background\s*:\s*var\(--ux025-solid-1\)/);
    assert.match(block[2], /backdrop-filter\s*:\s*none/);
    assert.match(block[2], /-webkit-backdrop-filter\s*:\s*none/);
  }
});

test('shared material, Home, and semantic tokens remain byte-for-byte unchanged', () => {
  const css = read('src/styles/tokens.css');
  for (const declaration of PROTECTED_TOKEN_LINES) assert.ok(css.includes(declaration), declaration);
  const main = read('src/styles/main.css');
  for (const declaration of [
    '--map-bg: #020a08;',
    '--map-grid: #0a2a20;',
    '--map-country: #0a2018;',
    '--map-stroke: #0f5040;',
  ]) assert.ok(main.includes(declaration), declaration);
});

test('UX-025 filters have prefixed partners and accessibility fallbacks', () => {
  const css = [
    read('src/styles/window-chrome.css'),
    read('src/styles/home-shell.css'),
    read('src/styles/macos-native.css'),
    read('src/styles/main.css'),
    read('src/styles/library.css'),
  ].join('\n');
  const uxBlocks = [...css.matchAll(/([^{}]+)\{([^{}]*--ux025-[^{}]*)\}/g)];
  assert.ok(uxBlocks.length > 0, 'no UX-025 consumers found');
  for (const [, selector, body] of uxBlocks) {
    if (!body.includes('backdrop-filter:')) continue;
    assert.ok(body.includes('-webkit-backdrop-filter:'), `missing prefixed filter in ${selector.trim()}`);
  }
  assert.match(css, /prefers-reduced-transparency[\s\S]*--ux025-blur-(?:chrome|raised)\s*:\s*none/);
  assert.match(css, /forced-colors[\s\S]*--ux025-blur-(?:chrome|raised)\s*:\s*none/);
  assert.match(css, /prefers-reduced-motion[\s\S]*--ux025-control-press-scale\s*:\s*1/);
}
);
