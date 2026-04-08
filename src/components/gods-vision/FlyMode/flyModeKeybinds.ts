export type FlySubMode = 1 | 2 | 3 | 4 | 5;

export const FLY_SUB_MODE_NAMES: Record<FlySubMode, string> = {
  1: 'FREE FLY',
  2: 'CINEMATIC',
  3: 'CHASE',
  4: 'CITY',
  5: 'ORBIT',
};

// Mouse look sensitivity (radians per pixel) — right-click drag
export const FLY_SENSITIVITY = 0.001;
