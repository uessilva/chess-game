import { describe, expect, it } from 'vitest';

import {
  advanceTween,
  createTween,
  easeInOutCubic,
  isTweenComplete,
  MOVE_DURATION_MS,
  tweenPosition,
  tweenProgress,
} from './animation';

describe('easeInOutCubic', () => {
  it('hits the endpoints and the exact midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    // Half the time is half the way: the spec's "eased midpoint".
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it('is non-linear (accelerates then decelerates)', () => {
    // Mid-half travel is steeper than the opening quarter: cubic in/out.
    const quarter = easeInOutCubic(0.25);
    const mid = easeInOutCubic(0.5);
    const threeQuarter = easeInOutCubic(0.75);
    expect(quarter).toBeLessThan(0.25); // slow start
    expect(threeQuarter).toBeGreaterThan(0.75); // fast then settling
    // The slope grows through the first half (ease-in acceleration):
    // the second quarter covers far more ground than the first.
    expect(mid - quarter).toBeGreaterThan(quarter);
  });

  it('is symmetric around the midpoint', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(easeInOutCubic(t) + easeInOutCubic(1 - t)).toBeCloseTo(1, 10);
    }
  });

  it('clamps inputs outside [0, 1]', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('createTween', () => {
  it('starts at the origin with zero elapsed time and the default duration', () => {
    const tween = createTween({ x: 10, y: 20 }, { x: 100, y: 200 });
    expect(tween.elapsedMs).toBe(0);
    expect(tween.durationMs).toBe(MOVE_DURATION_MS);
    expect(tweenPosition(tween)).toEqual({ x: 10, y: 20 });
  });

  it('honors a custom duration', () => {
    const tween = createTween({ x: 0, y: 0 }, { x: 64, y: 0 }, 500);
    expect(tween.durationMs).toBe(500);
  });
});

describe('advanceTween', () => {
  it('adds delta time without mutating the input tween', () => {
    const tween = createTween({ x: 0, y: 0 }, { x: 64, y: 0 });
    const advanced = advanceTween(tween, 100);
    expect(advanced.elapsedMs).toBe(100);
    expect(tween.elapsedMs).toBe(0);
  });
});

describe('tweenPosition', () => {
  const from = { x: 0, y: 448 };
  const to = { x: 256, y: 448 };

  it('leaves the piece at its origin at t=0', () => {
    const tween = createTween(from, to, 250);
    expect(tweenPosition(advanceTween(tween, 0))).toEqual(from);
  });

  it('places the piece at the eased midpoint at t=125 of a 250 ms tween', () => {
    const tween = createTween(from, to, 250);
    const atHalf = tweenPosition(advanceTween(tween, 125));
    // easeInOutCubic(0.5) = 0.5 → exactly halfway along the straight line.
    expect(atHalf).toEqual({ x: 128, y: 448 });
  });

  it('lands exactly on the destination at t=250 and never moves further', () => {
    const tween = createTween(from, to, 250);
    expect(tweenPosition(advanceTween(tween, 250))).toEqual(to);
    // Past-duration updates clamp: still exactly on the destination.
    expect(tweenPosition(advanceTween(tween, 250 + 1000))).toEqual(to);
    expect(tweenPosition(advanceTween(tween, 250 * 4))).toEqual(to);
  });

  it('interpolates vertically for a rank-changing move', () => {
    const tween = createTween({ x: 256, y: 384 }, { x: 256, y: 256 }, 250);
    expect(tweenPosition(advanceTween(tween, 125))).toEqual({ x: 256, y: 320 });
  });

  it('reports completion only once the duration has elapsed', () => {
    const tween = createTween(from, to, 250);
    expect(isTweenComplete(advanceTween(tween, 0))).toBe(false);
    expect(isTweenComplete(advanceTween(tween, 249.9))).toBe(false);
    expect(isTweenComplete(advanceTween(tween, 250))).toBe(true);
  });

  it('advances the eased position monotonically toward the destination', () => {
    let previous = 0;
    for (let ms = 0; ms <= 250; ms += 5) {
      const tween = advanceTween(createTween(from, to, 250), ms);
      expect(tweenProgress(tween)).toBeGreaterThanOrEqual(previous);
      previous = tweenProgress(tween);
    }
  });
});
