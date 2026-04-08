export const BETA_MODE = typeof window !== 'undefined'
  && localStorage.getItem('crystalball-beta-mode') === 'true';
