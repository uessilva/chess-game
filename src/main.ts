import {
  generateLegalMoves,
  makeMove,
  parseFen,
  START_FEN,
  toFen,
} from './core';
import type { Color, PieceType, Square } from './core';
import {
  DEFAULT_SQUARE_SIZE,
  pixelToSquare,
  preloadSprites,
  renderBoard,
  renderSelection,
  SPRITE_SOURCES,
  spriteKeyFor,
} from './ui';
import type { BoardOrientation, Point, SpriteMap } from './ui';
import { createController } from './ui/controller';
import type { Controller } from './ui/controller';
import { createDragMachine } from './ui/drag';
import type { GestureResolution } from './ui/drag';
import {
  deriveGameStatus,
  gameOverLabel,
  isTerminal,
  statusLineLabel,
} from './ui/gameStatus';
import type { GameStatus } from './ui/gameStatus';
import { createMoveAnimator } from './ui/moveAnimator';
import type { MoveAnimator } from './ui/moveAnimator';
import { createSoundPlayer } from './ui/sounds';
import type { SoundPlayer } from './ui/sounds';

export interface BoardMountResult {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Resolves once the sprites have loaded and the final frame is rendered. */
  readonly spritesLoaded: Promise<void>;
  /** Click-to-move controller driving the board's core state. */
  readonly controller: Controller;
  /**
   * Piece-animation overlay state (task 2.5): active flights, last-move
   * highlight, and check glow — pure UI state over the committed core.
   */
  readonly animator: MoveAnimator;
  /** Status line element showing whose turn it is (plus the "Check!" marker). */
  readonly statusLine: HTMLElement;
  /** Game-over banner: result and reason, visible only when the game is over. */
  readonly banner: HTMLElement;
  /** "New game" control: resets core and every piece of UI state. */
  readonly newGameButton: HTMLElement;
  /** Promotion picker: Q/R/B/N in the mover's color, visible while a promotion is pending. */
  readonly picker: HTMLElement;
  /** Stop the rAF game loop and detach the pointer listeners. */
  readonly stop: () => void;
}

/**
 * A promotion picker button: which piece it commits and in whose color.
 * The sprite `<img>` inside swaps src with the mover's color each time the
 * picker opens.
 */
export interface PromotionChoiceButton extends HTMLButtonElement {
  pieceType: PieceType;
  color: Color;
  pieceImage: HTMLImageElement;
}

export interface BoardMountOptions {
  readonly fen?: string;
  /** Bottom-edge color; the default 'white' puts rank 1 at the bottom. */
  readonly orientation?: BoardOrientation;
  readonly createImage?: () => HTMLImageElement;
  /** Injectable rAF so tests can drive the game loop deterministically. */
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
  /** Injectable sound player; defaults to synthesized Web Audio tones. */
  readonly sound?: SoundPlayer;
  /**
   * Game mode: 'local' is two humans on one board (the default); 'engine'
   * gives one side to the engine (task 3.2), which searches in a Web
   * Worker so the UI thread never blocks.
   */
  readonly mode?: 'local' | 'engine';
  /** The engine's color in engine mode; defaults to Black. */
  readonly engineColor?: Color;
  /**
   * Maximum search depth cap for engine moves; defaults to 4 (issue 3.2).
   * The engine now thinks on a time budget (3.4) — this caps how deep its
   * iterative deepening may go.
   */
  readonly engineDepth?: number;
  /**
   * The engine's thinking budget in milliseconds (issue 3.4); defaults to
   * 2000. The worker abandons an over-budget iteration and reports the
   * last fully completed one.
   */
  readonly engineTimeMs?: number;
  /**
   * Injectable worker factory (the createImage / requestFrame injection
   * pattern): tests substitute a fake worker; the default builds Vite's
   * module worker from ./engine/worker.ts.
   */
  readonly createWorker?: () => EngineWorker;
}

/**
 * The wire protocol the UI speaks to the engine worker (task 3.2, extended
 * by 3.4). FEN is the serializable boundary contract — the worker parses
 * the position itself, matching core's plain-data principle. The types are
 * declared here (structurally identical to the worker's own) so `src/ui`
 * never imports from `src/engine`; TypeScript's structural typing keeps
 * the two sides compatible.
 */
export interface EngineSearchRequest {
  readonly type: 'search';
  readonly requestId: number;
  readonly fen: string;
  /** The thinking budget in milliseconds (issue 3.4). */
  readonly timeMs: number;
  /** Maximum-depth cap for iterative deepening. */
  readonly depth: number;
}

export interface EngineSearchResult {
  readonly type: 'search-result';
  readonly requestId: number;
  readonly move: {
    readonly from: number;
    readonly to: number;
    readonly promotion?: PieceType;
  } | null;
  readonly score: number;
  /** Deepest fully completed iteration (issue 3.4). */
  readonly depth: number;
  /** Total nodes searched across all iterations. */
  readonly nodes: number;
  /** Elapsed milliseconds. */
  readonly elapsedMs: number;
}

/** The subset of the Worker API the board uses. */
export interface EngineWorker {
  postMessage(message: EngineSearchRequest): void;
  onmessage: ((event: MessageEvent<EngineSearchResult>) => void) | null;
  terminate?: () => void;
}

/** Vite's module-worker form: the worker bundles ./engine/worker.ts. */
function createDefaultWorker(): EngineWorker {
  return new Worker(new URL('./engine/worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as EngineWorker;
}

/**
 * Mount a playable two-player board into `container` rendering `START_FEN`
 * (or `options.fen`). A rAF-driven game loop owns the frame cadence: each
 * frame computes delta time, runs an **update** phase (advances the #14
 * piece-animation overlay and refreshes the check glow — status refreshes on
 * move commit via syncUi), then a **render** phase that draws the core
 * state plus the last-move/check overlays, the selection overlay, any
 * in-flight moving pieces, and any lifted drag piece. Pointer events
 * are translated to the drag state machine (page coords → canvas pixels via
 * the bounding rect → `pixelToSquare`), which resolves each gesture as
 * either a #11 click (delegated to the controller), a promotion drop (held
 * in UI state so the picker opens), or a drag (applied through the same
 * `makeMove` path when legal, reverted otherwise). Core state changes only
 * through the controller and drag machine — the board always reflects (core
 * state, selection, drag, animation overlay, game status). Committed moves
 * are handed to the animation overlay: click commits glide, drag commits
 * snap; while a flight is in flight move input is locked out. Delta time is
 * threaded through the update/render phases for #14's animations.
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

  // Piece-animation overlay (task 2.5): pure UI state advanced by the game
  // loop's delta time. It reads the committed core state for the check glow
  // and never gates, blocks, or rolls back a core move.
  const animator = createMoveAnimator({
    state,
    squareSize: DEFAULT_SQUARE_SIZE,
    orientation,
    sound: options.sound ?? createSoundPlayer(),
  });

  const statusLine = document.createElement('div');
  statusLine.className = 'status-line';
  container.appendChild(statusLine);

  const banner = document.createElement('div');
  banner.className = 'game-over-banner';
  banner.hidden = true;
  container.appendChild(banner);

  const newGameButton = document.createElement('button');
  newGameButton.className = 'new-game';
  newGameButton.textContent = 'New game';
  container.appendChild(newGameButton);

  // Promotion picker: four piece choices in the moving side's color. The
  // buttons are built once; syncPicker swaps each sprite's src to the
  // mover's color whenever the picker opens.
  const picker = document.createElement('div');
  picker.className = 'promotion-picker';
  picker.hidden = true;
  container.appendChild(picker);

  const PROMOTION_CHOICES = ['queen', 'rook', 'bishop', 'knight'] as const;
  const pickerButtons: PromotionChoiceButton[] = PROMOTION_CHOICES.map(
    (pieceType) => {
      const button = document.createElement('button') as PromotionChoiceButton;
      button.className = 'promotion-choice';
      button.pieceType = pieceType;
      button.color = 'white';
      const pieceImage = document.createElement('img');
      button.appendChild(pieceImage);
      button.pieceImage = pieceImage;
      picker.appendChild(button);
      button.addEventListener('click', () => {
        // Choosing a piece commits the held promotion; animate it (a picker
        // choice is a click-style commit, never a drag snap).
        const historyLength = state.history.length;
        controller.choosePromotion(pieceType);
        commitFromHistory(false, historyLength);
        syncUi();
        // If the promoted side's turn hands over to the engine, it moves now.
        dispatchEngineSearch();
      });
      return button;
    },
  );

  // Game status is re-derived on every move commit and on New game — status
  // only changes at those points (spec 2.4), so the loop never re-derives
  // per frame.
  let status: GameStatus = deriveGameStatus(state);

  const syncPicker = (): void => {
    const pending = controller.pendingPromotion;
    picker.hidden = pending === null;
    if (pending === null) {
      return;
    }
    for (const button of pickerButtons) {
      button.color = pending.color;
      button.pieceImage.src =
        SPRITE_SOURCES[
          spriteKeyFor({ color: pending.color, type: button.pieceType })
        ];
    }
  };

  const syncUi = (): void => {
    status = deriveGameStatus(state);
    statusLine.textContent = statusLineLabel(status, state.turn);
    const over = isTerminal(status);
    banner.hidden = !over;
    banner.textContent = over ? (gameOverLabel(status) ?? '') : '';
    syncPicker();
  };
  syncUi();

  const emptySprites: SpriteMap = {};
  let currentSprites: SpriteMap = emptySprites;
  const render = (delta: number): void => {
    void delta;
    const dragState = drag.drag;
    const lifted =
      dragState !== null && dragState.dragging
        ? { from: dragState.from, position: dragState.position }
        : undefined;
    renderBoard(ctx, state, currentSprites, {
      orientation,
      lifted,
      highlights: {
        lastMove: animator.lastMove,
        checkSquare: animator.checkSquare,
      },
      movingPieces: animator.flights,
    });
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

  /**
   * Animate the most recently committed core move, if one was pushed since
   * `historyLength`. `snap` marks a drag-dropped move (#12): the piece is
   * already under the pointer, so it snaps into place with no tween —
   * last-move highlight and sounds still apply.
   */
  const commitFromHistory = (snap: boolean, historyLength: number): void => {
    if (state.history.length > historyLength) {
      animator.commitMove(state.history[state.history.length - 1].move, snap);
    }
  };

  const resolve = (
    resolution: GestureResolution,
    historyLengthBefore: number,
  ): void => {
    if (resolution.kind === 'click') {
      // Within the click/drag threshold: #11's click flow runs unchanged.
      const historyLength = state.history.length;
      controller.handleSquareClick(resolution.square);
      commitFromHistory(false, historyLength);
    } else if (resolution.kind === 'promotion') {
      // A drop that only resolves to promotion variants: hold the move in
      // UI state and open the picker (supersedes #12's silent no-op).
      controller.holdPromotion(resolution.from, resolution.to);
    } else if (resolution.kind === 'drag-move') {
      // A completed drag applied its move inside the drag machine; animate
      // it as a snap (no tween replayed from the piece's origin).
      controller.clearSelection();
      commitFromHistory(true, historyLengthBefore);
    } else {
      // A reverted drag supersedes the click UI.
      controller.clearSelection();
    }
    syncUi();
    // A committed human move may hand the turn to the engine; a move that
    // only changed selection/promotion state leaves the turn alone and this
    // is a no-op.
    dispatchEngineSearch();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (searchPending) {
      // The engine is thinking: board input is locked (no selection, no
      // moves) until the reply lands — same discipline as the animation
      // lock, but for the engine's turn. New game stays available.
      return;
    }
    if (controller.pendingPromotion !== null) {
      // Clicking outside the open picker cancels the pending promotion; the
      // click itself never starts a gesture or changes selection.
      controller.cancelPromotion();
      syncUi();
      return;
    }
    if (animator.isAnimating) {
      // A piece animation is in flight: the move is already applied in core,
      // so no new gesture starts and the selection stays put — a UI lockout
      // preventing conflicting tweens, never a core rollback.
      return;
    }
    if (isTerminal(status)) {
      // Game over: the board is frozen — the only active control is
      // New game.
      return;
    }
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
    const historyLength = state.history.length;
    const resolution = drag.pointerUp(x, y);
    if (resolution !== null) {
      resolve(resolution, historyLength);
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
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && controller.pendingPromotion !== null) {
      controller.cancelPromotion();
      syncUi();
    }
  };
  const onNewGame = (): void => {
    if (drag.drag !== null) {
      drag.pointerCancel(); // abort any in-flight lift: piece reverts, no move
    }
    if (searchPending) {
      // Cancel the in-flight search: bump the id so a late reply is stale
      // and can never move pieces in the fresh game.
      latestRequestId++;
      searchPending = false;
    }
    // No confirmation dialog — immediate reset for casual local play.
    controller.reset();
    animator.reset();
    syncUi();
    // In engine mode the engine is a side like any other: if it is White,
    // it opens the fresh game; if Black it waits for the first human move.
    dispatchEngineSearch();
  };
  newGameButton.addEventListener('click', onNewGame);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('lostpointercapture', onLostPointerCapture);
  document.addEventListener('keydown', onKeyDown);

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
    // Advance the piece-animation overlay by delta time; completed flights
    // drop and the check glow refreshes from core's isInCheck. Game status
    // itself is re-derived on move commit (syncUi), not per frame.
    animator.update(delta);
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

  // Engine mode (task 3.2): the engine is a side, exactly like a human —
  // after any committed move that hands it the turn (and on mount when it
  // is White), the board dispatches a search to the worker. FEN is the
  // serializable boundary; the reply arrives with the requestId of the
  // request it answers, and any reply whose id is no longer current is
  // stale (superseded by New game or stop) and never applies a move.
  const mode = options.mode ?? 'local';
  const engineColor = options.engineColor ?? 'black';
  const engineDepth = options.engineDepth ?? 4;
  const engineTimeMs = options.engineTimeMs ?? 2000;
  const createWorker = options.createWorker ?? createDefaultWorker;
  let engineWorker: EngineWorker | null = null;
  let searchPending = false;
  let requestSeq = 0;
  let latestRequestId = 0;

  /**
   * Apply the engine's committed move through the same path as a human
   * move: find the legal Move matching the wire from/to/promotion, then
   * makeMove + the animation overlay + syncUi — last-move highlight, check
   * glow, and sounds work unchanged. Promotion moves arrive with the piece
   * already chosen by the search.
   */
  const onEngineResult = (event: MessageEvent<EngineSearchResult>): void => {
    const message = event.data;
    if (message.type !== 'search-result') {
      return;
    }
    if (message.requestId !== latestRequestId) {
      return; // stale reply from a superseded search — drop it
    }
    searchPending = false;
    const moveData = message.move;
    if (moveData === null) {
      // The engine found no legal move. The dispatch guard never searches a
      // terminal position, so this is defensive: just re-sync the UI.
      syncUi();
      return;
    }
    const historyLength = state.history.length;
    const move = generateLegalMoves(state).find(
      (m) =>
        m.from === moveData.from &&
        m.to === moveData.to &&
        m.promotion === moveData.promotion,
    );
    if (move !== undefined) {
      makeMove(state, move);
    }
    commitFromHistory(false, historyLength);
    syncUi();
  };

  /**
   * Dispatch a search if it is the engine's turn and the game is live.
   * While the search is in flight the status line shows the thinking
   * indicator and `searchPending` locks board input.
   */
  const dispatchEngineSearch = (): void => {
    if (mode !== 'engine' || engineWorker === null || searchPending) {
      return;
    }
    if (state.turn !== engineColor) {
      return;
    }
    if (isTerminal(status)) {
      return; // never search a finished game
    }
    const requestId = ++requestSeq;
    latestRequestId = requestId;
    searchPending = true;
    statusLine.textContent = 'Engine thinking…';
    engineWorker.postMessage({
      type: 'search',
      requestId,
      fen: toFen(state),
      timeMs: engineTimeMs,
      depth: engineDepth,
    });
  };

  if (mode === 'engine') {
    engineWorker = createWorker();
    engineWorker.onmessage = onEngineResult;
    dispatchEngineSearch(); // engine-White opens the game on mount
  }

  return {
    canvas,
    ctx,
    spritesLoaded,
    controller,
    animator,
    statusLine,
    banner,
    newGameButton,
    picker,
    stop: () => {
      if (searchPending) {
        latestRequestId++; // drop any late reply before tearing down
        searchPending = false;
      }
      engineWorker?.terminate?.();
      engineWorker = null;
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}

if (typeof document !== 'undefined') {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    mountBoard(app);
  }
}
