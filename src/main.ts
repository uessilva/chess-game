import { parseFen, START_FEN } from './core';
import type { Square } from './core';
import {
  DEFAULT_SQUARE_SIZE,
  pixelToSquare,
  preloadSprites,
  renderBoard,
  renderSelection,
} from './ui';
import type { SpriteMap } from './ui';
import { createController, turnLabel } from './ui/controller';
import type { Controller } from './ui/controller';

export interface BoardMountResult {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Resolves once the sprites have loaded and the final frame is rendered. */
  readonly spritesLoaded: Promise<void>;
  /** Click-to-move controller driving the board's core state. */
  readonly controller: Controller;
  /** Status line element showing whose turn it is. */
  readonly statusLine: HTMLElement;
  /** Stop the rAF game loop. */
  readonly stop: () => void;
}

export interface BoardMountOptions {
  readonly fen?: string;
  readonly createImage?: () => HTMLImageElement;
  /** Injectable rAF so tests can drive the game loop deterministically. */
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
}

/**
 * Mount a playable two-player board into `container` rendering `START_FEN`
 * (or `options.fen`). A rAF-driven game loop owns the frame cadence: each
 * frame computes delta time, runs an **update** phase that applies the queued
 * click intents (translated to squares via `pixelToSquare`) to the controller,
 * then a **render** phase that draws the core state plus the selection
 * overlay. Core state changes only through the controller — which consumes
 * `generateLegalMoves`/`makeMove` exactly as exported — so the board always
 * reflects (core state, selection). Delta time is threaded through the phases
 * for #14's animations to consume.
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
  const controller = createController(state);

  const statusLine = document.createElement('div');
  statusLine.className = 'status-line';
  statusLine.textContent = turnLabel(state.turn);
  container.appendChild(statusLine);

  const emptySprites: SpriteMap = {};
  let currentSprites: SpriteMap = emptySprites;
  const render = (delta: number): void => {
    // delta is threaded through for #14's animations; 2.2 draws every frame.
    void delta;
    renderBoard(ctx, state, currentSprites);
    renderSelection(ctx, controller.selection);
  };
  render(0);

  const spritesLoaded = preloadSprites(options.createImage).then(
    (sprites) => {
      currentSprites = sprites;
      render(0);
    },
    (error: unknown) => {
      console.error(error);
    },
  );

  // Click wiring: translate canvas clicks to squares and queue them as input
  // intents for the update phase.
  const intents: Square[] = [];
  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const sq = pixelToSquare(
      event.clientX - rect.left,
      event.clientY - rect.top,
      DEFAULT_SQUARE_SIZE,
    );
    if (sq !== null) {
      intents.push(sq);
    }
  });

  // Game loop: rAF-driven with update/render separation.
  const scheduleFrame =
    options.requestFrame ??
    (typeof requestAnimationFrame !== 'undefined'
      ? (cb: FrameRequestCallback): number => requestAnimationFrame(cb)
      : null);
  const cancelFrame =
    options.cancelFrame ??
    (typeof cancelAnimationFrame !== 'undefined'
      ? (id: number): void => cancelAnimationFrame(id)
      : () => {});
  let frameId: number | null = null;
  let lastTime = 0;

  const update = (delta: number): void => {
    // delta is threaded through for #14's animations; 2.2 only applies clicks.
    void delta;
    while (intents.length > 0) {
      const sq = intents.shift();
      if (sq !== undefined) {
        controller.handleSquareClick(sq);
      }
    }
    statusLine.textContent = turnLabel(state.turn);
  };

  const frame = (time: number): void => {
    const delta = lastTime === 0 ? 0 : time - lastTime;
    lastTime = time;
    update(delta);
    render(delta);
    if (scheduleFrame !== null) {
      frameId = scheduleFrame(frame);
    }
  };

  if (scheduleFrame !== null) {
    frameId = scheduleFrame(frame);
  }

  return {
    canvas,
    ctx,
    spritesLoaded,
    controller,
    statusLine,
    stop: () => {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
    },
  };
}

if (typeof document !== 'undefined') {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    mountBoard(app);
  }
}
