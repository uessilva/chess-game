import { parseFen, START_FEN } from './core';
import { DEFAULT_SQUARE_SIZE, preloadSprites, renderBoard } from './ui';
import type { SpriteMap } from './ui';

export interface BoardMountResult {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Resolves once the sprites have loaded and the final frame is rendered. */
  readonly spritesLoaded: Promise<void>;
}

export interface BoardMountOptions {
  readonly fen?: string;
  readonly createImage?: () => HTMLImageElement;
}

/**
 * Mount a static canvas board into `container` rendering `START_FEN` (or
 * `options.fen`). The 8x8 board squares are drawn immediately; the pieces are
 * blitted once the cburnett sprites finish loading. A failed asset load is
 * surfaced to the console rather than leaving a blank page.
 */
export function mountBoard(
  container: HTMLElement,
  options: BoardMountOptions = {},
): BoardMountResult {
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_SQUARE_SIZE * 8;
  canvas.height = DEFAULT_SQUARE_SIZE * 8;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('mountBoard: 2d rendering context unavailable');
  }

  const state = parseFen(options.fen ?? START_FEN);
  const emptySprites: SpriteMap = {};
  renderBoard(ctx, state, emptySprites);

  const spritesLoaded = preloadSprites(options.createImage).then(
    (sprites) => {
      renderBoard(ctx, state, sprites);
    },
    (error: unknown) => {
      console.error(error);
    },
  );

  return { canvas, ctx, spritesLoaded };
}

if (typeof document !== 'undefined') {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    mountBoard(app);
  }
}
