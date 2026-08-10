import type { Point } from './boardGeometry';

/**
 * Pure tween math for piece animations (task 2.5). No DOM, canvas, or
 * Image references — this module runs in Vitest's default node environment,
 * following the `boardGeometry.ts` pattern. The game loop advances active
 * tweens by delta time; the render step interpolates the moving piece's
 * pixel position from the tween.
 */

/** Default duration of one move glide, in milliseconds. */
export const MOVE_DURATION_MS = 250;

/**
 * A straight-line tween between two pixel points over a finite duration.
 * `elapsedMs` starts at 0 and grows by delta time; `tweenProgress` clamps it
 * at the duration, so updates past the end never move the piece further.
 */
export interface Tween {
  readonly from: Point;
  readonly to: Point;
  readonly elapsedMs: number;
  readonly durationMs: number;
}

/**
 * Ease-in-out cubic: symmetric S-curve, zero slope at both ends, midpoint
 * exactly at t = 0.5. The spec's "eased midpoint" — at half the duration the
 * piece sits exactly halfway between origin and destination.
 */
export function easeInOutCubic(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** A fresh tween from a point to another, elapsed time zeroed. */
export function createTween(
  from: Point,
  to: Point,
  durationMs: number = MOVE_DURATION_MS,
): Tween {
  return { from, to, elapsedMs: 0, durationMs };
}

/** Advance a tween by a frame's delta time (ms). */
export function advanceTween(tween: Tween, deltaMs: number): Tween {
  return { ...tween, elapsedMs: tween.elapsedMs + deltaMs };
}

/** Linear progress 0..1, clamped so past-duration updates stay at 1. */
export function tweenProgress(tween: Tween): number {
  return tween.durationMs <= 0
    ? 1
    : Math.min(1, tween.elapsedMs / tween.durationMs);
}

/** True once the tween has reached its destination. */
export function isTweenComplete(tween: Tween): boolean {
  return tweenProgress(tween) >= 1;
}

/**
 * The eased interpolated pixel position at the tween's current elapsed time.
 * At t=0 it is exactly `from`; at t >= duration it is exactly `to` — the
 * final frame lands on the destination with no overshoot or drift.
 */
export function tweenPosition(tween: Tween): Point {
  const progress = easeInOutCubic(tweenProgress(tween));
  return {
    x: tween.from.x + (tween.to.x - tween.from.x) * progress,
    y: tween.from.y + (tween.to.y - tween.from.y) * progress,
  };
}
