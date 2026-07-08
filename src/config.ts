export const GAME_CONFIG = {
  player: {
    walkSpeed: 4.2,
    boostSpeed: 8.2,
    radius: 0.55,
  },
  fridge: {
    easyBaseSpeed: 2.45,
    normalBaseSpeed: 4.75,
    catchDistance: 1.7,
  },
  calories: {
    walkPerSecond: 2.2,
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
    itemCount: 5,
    label: '少し疲れている',
  },
  normal: {
    fridgeSpeed: GAME_CONFIG.fridge.normalBaseSpeed,
    itemCount: 3,
    label: '今日は頑張る',
  },
} satisfies Record<
  Difficulty,
  { fridgeSpeed: number; itemCount: number; label: string }
>;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (start: number, end: number, rate: number) =>
  start + (end - start) * rate;
