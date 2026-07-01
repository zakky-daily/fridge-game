export const GAME_CONFIG = {
  player: {
    walkSpeed: 4.2,
    dashSpeed: 6.1,
    boostSpeed: 8.2,
    radius: 0.55,
  },
  fridge: {
    easyBaseSpeed: 2.65,
    normalBaseSpeed: 3.35,
    minSpeedRate: 0.42,
    catchDistance: 1.7,
  },
  calories: {
    walkPerSecond: 2.2,
    dashPerSecond: 3.8,
    boostPerSecond: 5.2,
    maxForScaling: 80,
  },
  boost: {
    duration: 4,
  },
} as const;

export type Difficulty = 'easy' | 'normal';

export const DIFFICULTY_SETTINGS = {
  easy: {
    fridgeSpeed: GAME_CONFIG.fridge.easyBaseSpeed,
    itemCount: 8,
    label: '少し疲れている',
  },
  normal: {
    fridgeSpeed: GAME_CONFIG.fridge.normalBaseSpeed,
    itemCount: 5,
    label: 'まだ動けそう',
  },
} satisfies Record<Difficulty, { fridgeSpeed: number; itemCount: number; label: string }>;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (start: number, end: number, rate: number) =>
  start + (end - start) * rate;
