import { parseFen, START_FEN } from './core';
import type { Square } from './core';
import {
  DEFAULT_SQUARE_SIZE,
  pixelToSquare,
  preloadSprites,
  renderBoard,
  renderSelection,
} from './ui';
import type { BoardOrientation, Point, SpriteMap } from './ui';
import { createController, turnLabel } from './ui/controller';
import type { Controller } from './ui/controller';
import { createDragMachine } from './ui/drag';
import type { GestureResolution } from './ui/drag';

export interface BoardMountResult {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Resolves once the sprites have loaded and the final frame is rendered. */
  readonly spritesLoaded: Promise<void>;
  /** Click-to-move controller driving the board's core state. */
  readonly controller: Controller;
  /** Status line element showing whose turn it is. */
  readonly statusLine: HTMLElement;
  /** Stop the rAF game loop and detach the pointer listeners. */
  readonly stop: () => void;
}

export interface BoardMountOptions {
  readonly fen?: string;
  /** Bottom-edge color; the default 'white' puts rank 1 at the bottom. */
  readonly orientation?: BoardOrientation;
  readonly createImage?: () => HTMLImageElement;
  /** Injectable rAF so tests can drive the game loop deterministically. */
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
}

/**
 * Mount a playable two-player board into `container` rendering `START_FEN`
 * (or `options.fen`). A rAF-driven game loop owns the frame cadence: each
 * frame computes delta time, runs an **update** phase that refreshes the
 * status line, then a **render** phase that draws the core state plus the
 * selection overlay and any lifted drag piece. Pointer events are translated
 * to the drag state machine (page coords → canvas pixels via the bounding
 * rect → `pixelToSquare`), which resolves each gesture as either a #11 click
 * (delegated to the controller) or a drag (applied through the same
 * `makeMove` path when legal, reverted otherwise). Core state changes only
 * through the controller and drag machine — the board always reflects (core
 * state, selection, drag). Delta time is threaded through the phases for
 * #14's animations to consume.
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

  const orientation = options.orientation ?? 'white';
  const state = parseFen(options.fen ?? START_FEN);
  const controller = createController(state);

  // Drag state machine: pure logic, fed canvas pixels. The hit test reuses
  // pixelToSquare with the render orientation, so lift/drop hit testing is
  // exactly the geometry the board is drawn with.
  const drag = createDragMachine({
    state,
    hitTest: (x: number, y: number): Square | null =>
      pixelToSquare(x, y, DEFAULT_SQUARE_SIZE, orientation),
  });

  const statusLine = document.createElement('div');
  statusLine.className = 'status-line';
  statusLine.textContent = turnLabel(state.turn);
  container.appendChild(statusLine);

  const emptySprites: SpriteMap = {};
  let currentSprites: SpriteMap = emptySprites;
  const render = (delta: number): void => {
    // delta is threaded through for #14's animations; 2.3 draws every frame.
    void delta;
    const dragState = drag.drag;
    const lifted =
      dragState !== null && dragState.dragging
        ? { from: dragState.from, position: dragState.position }
        : undefined;
    renderBoard(ctx, state, currentSprites, { orientation, lifted });
    // While a piece is lifted, hide the (now stale) selection overlay — the
    // drag is the only interaction rendered; it clears on drop/cancel anyway.
    renderSelection(
      ctx,
      dragState !== null && dragState.dragging ? null : controller.selection,
    );
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

  // Pointer wiring: translate page coordinates to canvas pixels via the
  // canvas bounding rect (handles the canvas being offset/zoomed in the
  // page), then feed the drag machine. Off-board points hit-test to no
  // square and start nothing; a drag releases there and reverts.
  const toCanvasPoint = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const resolve = (resolution: GestureResolution): void => {
    if (resolution.kind === 'click') {
      // Within the click/drag threshold: #11's click flow runs unchanged.
      controller.handleSquareClick(resolution.square);
    } else {
      // A completed drag (move applied or reverted) supersedes the click UI.
      controller.clearSelection();
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    const { x, y } = toCanvasPoint(event);
    // Grabbing capture keeps the pointer stream flowing to the canvas even
    // when the pointer leaves it mid-drag.
    if (drag.pointerDown(x, y)) {
      canvas.setPointerCapture(event.pointerId);
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    const { x, y } = toCanvasPoint(event);
    drag.pointerMove(x, y);
  };
  const onPointerUp = (event: PointerEvent): void => {
    const { x, y } = toCanvasPoint(event);
    const resolution = drag.pointerUp(x, y);
    if (resolution !== null) {
      resolve(resolution);
    }
  };
  const onPointerCancel = (): void => {
    if (drag.pointerCancel()) {
      controller.clearSelection();
    }
  };
  const onLostPointerCapture = (): void => {
    // Capture can drop without pointercancel (element removal, UA quirks):
    // abort an in-progress drag explicitly.
    if (drag.drag !== null) {
      drag.pointerCancel();
      controller.clearSelection();
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('lostpointercapture', onLostPointerCapture);

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
    // delta is threaded through for #14's animations; 2.3 refreshes the turn.
    void delta;
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
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
    },
  };
}

if (typeof document !== 'undefined') {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    mountBoard(app);
  }
}
