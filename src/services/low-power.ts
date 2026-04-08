const KEY = 'wm-low-power-mode';

export function isLowPowerMode(): boolean {
  return localStorage.getItem(KEY) === 'true';
}

export function setLowPowerMode(val: boolean): void {
  localStorage.setItem(KEY, String(val));
  document.dispatchEvent(new CustomEvent('wm:low-power-changed', { detail: val }));
}
