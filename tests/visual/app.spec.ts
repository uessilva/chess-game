import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Visual regression suite (task 2.6): locks in the three key UI states that
 * #11-#14 produce. Real pointer clicks drive the production game loop (the
 * #11 click-to-move path), so the captures exercise the shipped interaction
 * end to end. Baselines live in `app.spec.ts-snapshots/` next to this file;
 * regenerate intentionally changed captures with
 * `npx playwright test --update-snapshots`.
 *
 * The pixel comparison captures the board canvas only (512x512) — text
 * (status line, game-over banner) is asserted semantically via `toHaveText`
 * because it is the only font-AA-noisy part of the page. A canvas-only frame
 * is pixel-identical across machines and keeps the diff tight enough that a
 * single 64x64 square recolor (4,096 px = 1.56% of the frame) fails the gate
 * (see `maxDiffPixelRatio` in playwright.config.ts).
 */

const SQUARE_SIZE = 64;

/** One move as [fromFile, fromRank, toFile, toRank], rank 0 = rank 1. */
type Move = readonly [number, number, number, number];

/** 1.e4 e5 2.Nf3 Nc6 — the mid-game capture state. */
const MID_GAME: readonly Move[] = [
  [4, 1, 4, 3], // 1.e4
  [4, 6, 4, 4], // 1...e5
  [6, 0, 5, 2], // 2.Nf3
  [1, 7, 2, 5], // 2...Nc6
];

/** Scholar's mate — the game-over capture state: 4.Qxf7#. */
const SCHOLARS_MATE: readonly Move[] = [
  [4, 1, 4, 3], // 1.e4
  [4, 6, 4, 4], // 1...e5
  [5, 0, 2, 3], // 2.Bc4
  [1, 7, 2, 5], // 2...Nc6
  [3, 0, 7, 4], // 3.Qh5
  [6, 7, 5, 5], // 3...Nf6
  [7, 4, 5, 6], // 4.Qxf7#
];

/** The move glide is 250 ms (src/ui/animation.ts); wait past it plus margin. */
const SETTLE_MS = 400;

/** Viewport-space center of a canvas square, given the canvas origin. */
function squareCenter(
  file: number,
  rank: number,
  origin: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: origin.x + file * SQUARE_SIZE + SQUARE_SIZE / 2,
    y: origin.y + (7 - rank) * SQUARE_SIZE + SQUARE_SIZE / 2,
  };
}

/** Load the app and wait until every piece sprite has been fetched. */
async function loadApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const spriteEntries = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/pieces/'));
    return spriteEntries.length >= 12;
  });
  // Give img.decode() and the first post-sprite frame a moment to land.
  await page.waitForTimeout(200);
}

/** The canvas's viewport-space origin (the page has no CSS reset). */
async function canvasOrigin(
  canvas: Locator,
): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error('canvas has no bounding box');
  }
  return { x: box.x, y: box.y };
}

/** Play one move as two clicks (select, then target) and wait for the glide. */
async function playMove(
  page: Page,
  origin: { x: number; y: number },
  move: Move,
): Promise<void> {
  const from = squareCenter(move[0], move[1], origin);
  const to = squareCenter(move[2], move[3], origin);
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await page.waitForTimeout(SETTLE_MS);
}

test('initial position is pixel-locked', async ({ page }) => {
  await loadApp(page);
  await expect(page.locator('.status-line')).toHaveText('White to move');
  await expect(page.locator('canvas')).toHaveScreenshot('initial.png');
});

test('mid-game after 1.e4 e5 2.Nf3 Nc6 is pixel-locked', async ({ page }) => {
  await loadApp(page);
  const canvas = page.locator('canvas');
  const origin = await canvasOrigin(canvas);
  for (const move of MID_GAME) {
    await playMove(page, origin, move);
  }
  await expect(page.locator('.status-line')).toHaveText('White to move');
  await expect(page.locator('canvas')).toHaveScreenshot('mid-game.png');
});

test('checkmate ends the game and the game-over screen is pixel-locked', async ({
  page,
}) => {
  await loadApp(page);
  const canvas = page.locator('canvas');
  const origin = await canvasOrigin(canvas);
  for (const move of SCHOLARS_MATE) {
    await playMove(page, origin, move);
  }
  await expect(page.locator('.game-over-banner')).toHaveText(
    'Checkmate — White wins',
  );
  await expect(page.locator('canvas')).toHaveScreenshot('game-over.png');
});
