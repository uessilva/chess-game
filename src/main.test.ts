import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountBoard } from './main';
import type {
  EngineSearchRequest,
  EngineSearchResult,
  EngineWorker,
  PromotionChoiceButton,
} from './main';
import { algebraicOf, PIECES, squareFromAlgebraic, toFen } from './core';
import { LIFT_OFFSET, squareToPixel, SPRITE_SOURCES } from './ui';
import type { BoardOrientation } from './ui';

/** toFen output for the starting position (the New game reset target). */
const START_TO_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Minimal element stub standing in for every DOM element mountBoard creates
 * besides the canvas. Distinct instances per tag keep banner / new-game /
 * picker / status-line assertions unambiguous, and each records listeners so
 * tests can click buttons and press Escape.
 */
type FakeElement = {
  tagName: string;
  className: string;
  hidden: boolean;
  textContent: string;
  src: string;
  children: FakeElement[];
  parentElement: FakeElement | null;
  listeners: Record<string, (event: unknown) => void>;
  appendChild: (child: FakeElement) => void;
  addEventListener: (type: string, cb: (event: unknown) => void) => void;
  removeEventListener: (type: string, cb: (event: unknown) => void) => void;
  click: () => void;
  [key: string]: unknown;
};

function createFakeElement(tagName: string): FakeElement {
  const listeners: Record<string, (event: unknown) => void> = {};
  const element: FakeElement = {
    tagName,
    className: '',
    hidden: false,
    textContent: '',
    src: '',
    children: [],
    parentElement: null,
    listeners,
    appendChild(child) {
      child.parentElement = element;
      element.children.push(child);
    },
    addEventListener(type, cb) {
      listeners[type] = cb;
    },
    removeEventListener(type, cb) {
      if (listeners[type] === cb) {
        delete listeners[type];
      }
    },
    click() {
      const cb = listeners['click'];
      if (cb !== undefined) {
        cb({});
      }
    },
  };
  return element;
}

function createFakeEnvironment(failSources: Set<string> = new Set()): {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  createImage: () => HTMLImageElement;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  statusLine: FakeElement;
  listeners: Record<string, (event: unknown) => void>;
  documentListeners: Record<string, (event: unknown) => void>;
  setPointerCapture: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  rect: Rect;
} {
  const fillRect = vi.fn();
  const drawImage = vi.fn();
  const beginPath = vi.fn();
  const moveTo = vi.fn();
  const arc = vi.fn();
  const fill = vi.fn();
  let currentFillStyle = '';
  const ctx = {
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    fillRect,
    drawImage,
    beginPath,
    moveTo,
    arc,
    fill,
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;

  const listeners: Record<string, (event: unknown) => void> = {};
  const documentListeners: Record<string, (event: unknown) => void> = {};
  const rect: Rect = {
    left: 0,
    top: 0,
    right: 512,
    bottom: 512,
    width: 512,
    height: 512,
  };
  const setPointerCapture = vi.fn();
  const removeEventListener = vi.fn(
    (type: string, cb: (event: unknown) => void) => {
      if (listeners[type] === cb) {
        delete listeners[type];
      }
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      listeners[type] = cb;
    }),
    removeEventListener,
    setPointerCapture,
    getBoundingClientRect: vi.fn(() => rect),
  } as unknown as HTMLCanvasElement;

  const statusLine = createFakeElement('div');

  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) =>
      tag === 'canvas'
        ? canvas
        : (createFakeElement(tag) as unknown as HTMLElement),
    ),
    addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      documentListeners[type] = cb;
    }),
    removeEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      if (documentListeners[type] === cb) {
        delete documentListeners[type];
      }
    }),
  });

  const container = { appendChild: vi.fn() } as unknown as HTMLElement;

  const createImage = () => {
    const decode = vi.fn(() => Promise.resolve());
    const img = { src: '', decode } as unknown as HTMLImageElement;
    decode.mockImplementation(() =>
      failSources.has(img.src)
        ? Promise.reject(new Error(`boom: ${img.src}`))
        : Promise.resolve(),
    );
    return img;
  };

  return {
    canvas,
    container,
    createImage,
    fillRect,
    drawImage,
    statusLine,
    listeners,
    documentListeners,
    setPointerCapture,
    removeEventListener,
    rect,
  };
}

/** Deterministic rAF stand-in: frames run only when the test drives them. */
function createFrameDriver(): {
  requestFrame: (cb: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  cancelFrameMock: ReturnType<typeof vi.fn>;
  runFrames: (times: number[]) => void;
} {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const requestFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  };
  const cancelFrameMock = vi.fn((id: number) => {
    pending.delete(id);
  });
  const runFrames = (times: number[]): void => {
    for (const time of times) {
      const entry = pending.entries().next().value as
        [number, FrameRequestCallback] | undefined;
      if (entry === undefined) {
        break;
      }
      const [id, cb] = entry;
      pending.delete(id);
      cb(time);
    }
  };
  return {
    requestFrame,
    cancelFrame: cancelFrameMock,
    cancelFrameMock,
    runFrames,
  };
}

type ClientPoint = { clientX: number; clientY: number };

/** Client-space point for a canvas pixel, honoring the fake bounding rect. */
function clientFor(
  env: ReturnType<typeof createFakeEnvironment>,
  x: number,
  y: number,
): ClientPoint {
  return { clientX: env.rect.left + x, clientY: env.rect.top + y };
}

/**
 * Client point at the center of a square (64px squares under the given
 * orientation), mirroring how a real pointer event lands on the canvas.
 */
function pointFor(
  env: ReturnType<typeof createFakeEnvironment>,
  algebraic: string,
  orientation: BoardOrientation = 'white',
): ClientPoint {
  const { x, y } = squareToPixel(
    squareFromAlgebraic(algebraic),
    64,
    orientation,
  );
  return clientFor(env, x + 32, y + 32);
}

type PointerType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture';

function firePointer(
  env: ReturnType<typeof createFakeEnvironment>,
  type: PointerType,
  point: ClientPoint = { clientX: 0, clientY: 0 },
): void {
  const listener = env.listeners[type];
  if (listener === undefined) {
    return; // no listener attached (e.g. after stop()) — nothing to deliver
  }
  listener(point);
}

/** Press and release at one square: a #11-style click gesture. */
function clickSquare(
  env: ReturnType<typeof createFakeEnvironment>,
  algebraic: string,
  orientation: BoardOrientation = 'white',
): void {
  firePointer(env, 'pointerdown', pointFor(env, algebraic, orientation));
  firePointer(env, 'pointerup', pointFor(env, algebraic, orientation));
}

/** Press, move, release across two squares: a deliberate drag. */
function dragPiece(
  env: ReturnType<typeof createFakeEnvironment>,
  from: string,
  to: string,
  orientation: BoardOrientation = 'white',
): void {
  firePointer(env, 'pointerdown', pointFor(env, from, orientation));
  firePointer(env, 'pointermove', pointFor(env, to, orientation));
  firePointer(env, 'pointerup', pointFor(env, to, orientation));
}

/** Canvas top-left pixel of each drawImage call, as [x, y] pairs. */
function drawnPositions(
  env: ReturnType<typeof createFakeEnvironment>,
): number[][] {
  return env.drawImage.mock.calls.map((args) => [args[1], args[2]]);
}

function sortedTargets(
  selection: {
    targets: readonly number[];
  } | null,
): number[] {
  if (selection === null) {
    return [];
  }
  return [...selection.targets].sort((a, b) =>
    algebraicOf(a) < algebraicOf(b) ? -1 : 1,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mountBoard', () => {
  it('mounts a canvas and renders the starting position once sprites load', async () => {
    const env = createFakeEnvironment();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
    });

    expect(env.canvas.width).toBe(512);
    expect(env.canvas.height).toBe(512);
    expect(env.container.appendChild).toHaveBeenCalledWith(env.canvas);

    // Board squares are visible immediately, before any sprite resolves.
    expect(env.fillRect).toHaveBeenCalledTimes(64);
    expect(env.drawImage).toHaveBeenCalledTimes(0);

    await result.spritesLoaded;
    // All 32 pieces of the starting position are drawn once sprites arrive.
    expect(env.drawImage).toHaveBeenCalledTimes(32);
  });

  it('renders a custom sparse FEN (two kings only) without stray pieces', async () => {
    const env = createFakeEnvironment();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
    });

    expect(env.fillRect).toHaveBeenCalledTimes(64);
    await result.spritesLoaded;
    expect(env.drawImage).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed sprite load as an error and still shows the board', async () => {
    const env = createFakeEnvironment(new Set([SPRITE_SOURCES.wQ]));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = mountBoard(env.container, {
      createImage: env.createImage,
    });

    expect(env.fillRect).toHaveBeenCalledTimes(64);
    await result.spritesLoaded; // resolves — the failure is surfaced, not fatal
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(env.drawImage).toHaveBeenCalledTimes(0);

    errorSpy.mockRestore();
  });
});

describe('mountBoard: playable game', () => {
  it('boots into a White-to-move start position with a status line', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    expect(result.statusLine.textContent).toBe('White to move');
  });

  it('moves a pawn on click, flips the turn, and updates the status line', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'e2');
    driver.runFrames([0]);
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('e2'));

    clickSquare(env, 'e4');
    driver.runFrames([16.7]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(result.statusLine.textContent).toBe('Black to move');
  });

  it('ignores clicks on the side not to move', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    clickSquare(env, 'b8');
    driver.runFrames([0]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.statusLine.textContent).toBe('White to move');
  });

  it('clears the selection on an empty square without moving', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    clickSquare(env, 'e2');
    driver.runFrames([0]);
    expect(result.controller.selection).not.toBeNull();

    clickSquare(env, 'e5');
    driver.runFrames([16.7]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.statusLine.textContent).toBe('White to move');
  });

  it('stops the game loop and detaches the pointer listeners on demand', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    result.stop();
    expect(driver.cancelFrameMock).toHaveBeenCalled();
    expect(env.removeEventListener).toHaveBeenCalledWith(
      'pointerdown',
      expect.any(Function),
    );

    clickSquare(env, 'e2');
    driver.runFrames([0, 16.7]);

    // The loop is stopped and the listeners detached: the click never lands.
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.statusLine.textContent).toBe('White to move');
  });
});

describe('mountBoard: drag-and-drop', () => {
  // NOTE: bare K+N vs K is now an auto-ended insufficient-material draw
  // (issue #13), so these FENs carry a black pawn on h7 to keep the game
  // live while the knight drag is exercised.
  const LIVE_KNIGHT_G1 = '4k3/7p/8/8/8/8/8/4K1N1 w - - 0 1';

  it('drags a knight to a legal square, lands it, and passes the turn', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    dragPiece(env, 'g1', 'e2');
    driver.runFrames([0]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(
      '4k3/7p/8/8/8/8/4N3/4K3 b - - 1 1',
    );
    expect(result.statusLine.textContent).toBe('Black to move');
  });

  it('renders the lifted piece following the pointer and its origin square empty', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    firePointer(env, 'pointerdown', pointFor(env, 'g1'));
    firePointer(env, 'pointermove', pointFor(env, 'e2'));
    driver.runFrames([0]);

    // g1 (384, 448) renders empty while the knight is lifted...
    expect(drawnPositions(env)).not.toContainEqual([384, 448]);
    // ...and the knight follows the pointer: centered at e2's center (288,
    // 416) plus the lift offset. The two kings and the h7 pawn still draw.
    expect(drawnPositions(env)).toContainEqual([
      288 - 32 + LIFT_OFFSET.x,
      416 - 32 + LIFT_OFFSET.y,
    ]);
    expect(drawnPositions(env)).toContainEqual([256, 448]); // e1 king
    expect(drawnPositions(env)).toContainEqual([448, 64]); // h7 pawn
    expect(env.drawImage).toHaveBeenCalledTimes(4);
  });

  it('snaps the piece back on an illegal drop: board and turn unchanged', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/4p3/8/8/8/4K1N1 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    dragPiece(env, 'g1', 'e5');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
    expect(result.controller.selection).toBeNull();
  });

  it('reverts a release outside the board without making a move', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    firePointer(env, 'pointerdown', pointFor(env, 'e2'));
    firePointer(env, 'pointermove', { clientX: 600, clientY: 416 }); // beyond the right canvas edge
    firePointer(env, 'pointerup', { clientX: 600, clientY: 416 });
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
  });

  it('reverts a drop onto an own piece', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/4P3/4K1N1 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    dragPiece(env, 'g1', 'e2');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
  });

  it('lets a quick click select and a follow-up click execute (click-to-move coexists)', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'e2');
    driver.runFrames([0]);
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('e2'));
    expect(sortedTargets(result.controller.selection)).toEqual([
      squareFromAlgebraic('e3'),
      squareFromAlgebraic('e4'),
    ]);

    clickSquare(env, 'e4');
    driver.runFrames([16.7]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(result.statusLine.textContent).toBe('Black to move');
  });

  it('does not let a piece of the side not to move be dragged', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    dragPiece(env, 'e4', 'e5');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('black');
    expect(result.controller.selection).toBeNull();
  });

  it('aborts the drag on pointercancel and reverts the piece', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    firePointer(env, 'pointerdown', pointFor(env, 'g1'));
    firePointer(env, 'pointermove', pointFor(env, 'e2'));
    firePointer(env, 'pointercancel');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
    expect(result.controller.selection).toBeNull();
  });

  it('aborts the drag on pointer capture loss mid-drag', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    firePointer(env, 'pointerdown', pointFor(env, 'g1'));
    firePointer(env, 'pointermove', pointFor(env, 'e2'));
    firePointer(env, 'lostpointercapture');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
  });

  it('ignores capture loss after a completed drop', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    dragPiece(env, 'g1', 'e2');
    firePointer(env, 'lostpointercapture');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(
      '4k3/7p/8/8/8/8/4N3/4K3 b - - 1 1',
    );
  });
});

describe('mountBoard: hit testing', () => {
  it('converts page coordinates through the canvas bounding rect and lifts the correct rook', async () => {
    const env = createFakeEnvironment();
    env.rect.left = 200;
    env.rect.top = 150;
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    // h1 center is canvas (480, 480); the press lands at the page point
    // (200 + 480, 150 + 480) and must lift the h1 rook, not the a1 rook.
    firePointer(env, 'pointerdown', pointFor(env, 'h1'));
    firePointer(env, 'pointermove', clientFor(env, 490, 490));
    driver.runFrames([0]);

    expect(env.setPointerCapture).toHaveBeenCalled();
    expect(drawnPositions(env)).not.toContainEqual([448, 448]); // h1 origin empty
    expect(drawnPositions(env)).toContainEqual([0, 448]); // a1 rook still on its square
    expect(drawnPositions(env)).toContainEqual([
      490 - 32 + LIFT_OFFSET.x,
      490 - 32 + LIFT_OFFSET.y,
    ]);
  });

  it('does not lift when the press maps to no square outside the canvas rect', async () => {
    const env = createFakeEnvironment();
    env.rect.left = 200;
    env.rect.top = 150;
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    // Page (50, 50) is far outside the canvas rect → no square → no lift.
    firePointer(env, 'pointerdown', { clientX: 50, clientY: 50 });
    firePointer(env, 'pointermove', { clientX: 60, clientY: 60 });
    driver.runFrames([0]);

    expect(env.setPointerCapture).not.toHaveBeenCalled();
    expect(drawnPositions(env)).toContainEqual([448, 448]); // h1 still drawn
    expect(env.drawImage).toHaveBeenCalledTimes(32);
  });

  it('lifts the correct rook under the black orientation', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      orientation: 'black',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    // In the black orientation h1 is at canvas (0, 0); pressing its center
    // (32, 32) must lift the h1 rook while the a1 rook stays at (448, 0).
    firePointer(env, 'pointerdown', pointFor(env, 'h1', 'black'));
    firePointer(env, 'pointermove', clientFor(env, 42, 32));
    driver.runFrames([0]);

    expect(drawnPositions(env)).not.toContainEqual([0, 0]); // h1 origin empty
    expect(drawnPositions(env)).toContainEqual([448, 0]); // a1 rook still drawn
    expect(drawnPositions(env)).toContainEqual([
      42 - 32 + LIFT_OFFSET.x,
      32 - 32 + LIFT_OFFSET.y,
    ]);
  });
});

/** The four promotion picker buttons, in mount order Q, R, B, N. */
function promotionChoices(result: {
  picker: HTMLElement;
}): PromotionChoiceButton[] {
  return Array.from(result.picker.children) as PromotionChoiceButton[];
}

describe('mountBoard: game-over banner and freeze', () => {
  it('shows "Checkmate — White wins" and freezes every board input except New game', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Checkmate — White wins');

    // Clicking Black pieces produces no selection, no dots, no move.
    clickSquare(env, 'g8');
    clickSquare(env, 'f7');
    driver.runFrames([0]);
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(
      '4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1',
    );

    // The only interactive control is New game.
    result.newGameButton.click();
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.banner.hidden).toBe(true);
  });

  it('shows "Stalemate — draw" and freezes the board', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: 'k7/8/1Q6/8/8/8/8/K7 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Stalemate — draw');

    clickSquare(env, 'a8');
    driver.runFrames([0]);
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
  });

  it('shows the "Check!" indicator and clears it once the evasion commits', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    expect(result.banner.hidden).toBe(true);
    expect(result.statusLine.textContent).toBe('White to move — Check!');

    // White evades with Kf1; the game continues with no indicator.
    clickSquare(env, 'e1');
    clickSquare(env, 'f1');
    expect(result.statusLine.textContent).toBe('Black to move');
    expect(result.banner.hidden).toBe(true);
  });

  it('auto-ends with "Draw by threefold repetition" after the third repetition', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    // 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3 Nf6 4.Ng1 Ng8 — the starting position
    // appears for the third time on the final move.
    const shuffle: [string, string][] = [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
    ];
    // Each commit starts a 250 ms glide (task 2.5); advance the loop past it
    // between moves so the next click is not locked out by the animation.
    // The loop's first frame forces delta 0, so each move needs two frames:
    // a no-advance frame then a 260 ms advance.
    let time = 0;
    for (const [from, to] of shuffle) {
      clickSquare(env, from);
      clickSquare(env, to);
      time += 1;
      driver.runFrames([time, time + 260]);
      time += 260;
    }

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Draw by threefold repetition');

    // The board freezes except New game.
    clickSquare(env, 'e2');
    expect(result.controller.selection).toBeNull();
  });

  it('auto-ends with "Draw by fifty-move rule" when the clock reaches 100', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    // K+2N vs K is live (not insufficient), so the only draw predicate is
    // the fifty-move threshold once the quiet king move hits 100.
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/1NN1K3 b - - 99 75',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    expect(result.banner.hidden).toBe(true);

    clickSquare(env, 'e8');
    clickSquare(env, 'e7');

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Draw by fifty-move rule');
  });

  it('auto-ends with "Draw by insufficient material" when the last piece falls', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    // White knight b5 captures the last black rook: K+N vs K is dead.
    const result = mountBoard(env.container, {
      fen: '4k3/r7/8/1N6/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    expect(result.banner.hidden).toBe(true);

    clickSquare(env, 'b5');
    clickSquare(env, 'a7');

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Draw by insufficient material');

    // No board input has any effect except New game.
    clickSquare(env, 'e8');
    expect(result.controller.selection).toBeNull();
    expect(result.controller.state.turn).toBe('black');
  });

  it('mounting a dead K vs K position reports the draw immediately', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    expect(result.banner.hidden).toBe(false);
    expect(result.banner.textContent).toBe('Draw by insufficient material');
  });
});

describe('mountBoard: promotion picker', () => {
  const PROMOTION_FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

  it('opens the picker on click-to-move and applies the chosen knight', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: PROMOTION_FEN,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    expect(result.picker.hidden).toBe(true);

    clickSquare(env, 'a7');
    clickSquare(env, 'a8');

    // The move is held, not committed — supersedes #11's default queen.
    expect(result.picker.hidden).toBe(false);
    expect(result.controller.pendingPromotion).not.toBeNull();
    expect(result.controller.state.board[squareFromAlgebraic('a8')]).toBeNull();
    expect(result.controller.state.turn).toBe('white');

    // Exactly Q, R, B, N in the moving side's color.
    const choices = promotionChoices(result);
    expect(choices.map((button) => button.pieceType)).toEqual([
      'queen',
      'rook',
      'bishop',
      'knight',
    ]);
    expect(choices.every((button) => button.color === 'white')).toBe(true);

    // Choosing the knight applies exactly that move.
    choices[3].click();
    expect(result.controller.state.board[squareFromAlgebraic('a8')]).toBe(
      PIECES.white.knight,
    );
    expect(result.controller.state.board[squareFromAlgebraic('a7')]).toBeNull();
    expect(result.controller.state.turn).toBe('black');
    expect(result.picker.hidden).toBe(true);
  });

  it('opens the picker on drag-and-drop and applies the chosen rook', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: PROMOTION_FEN,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    dragPiece(env, 'a7', 'a8');

    // Neither #12's silent no-op nor #11's queen default: the picker opens.
    expect(result.picker.hidden).toBe(false);
    expect(result.controller.pendingPromotion).not.toBeNull();
    expect(toFen(result.controller.state)).toBe(before);

    promotionChoices(result)[1].click(); // rook
    expect(result.controller.state.board[squareFromAlgebraic('a8')]).toBe(
      PIECES.white.rook,
    );
    expect(result.controller.state.turn).toBe('black');
    expect(result.picker.hidden).toBe(true);
  });

  it('offers the four pieces in the black color for a black promotion', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/p7/4K3 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'a2');
    clickSquare(env, 'a1');

    expect(result.picker.hidden).toBe(false);
    const choices = promotionChoices(result);
    expect(choices.every((button) => button.color === 'black')).toBe(true);

    choices[3].click(); // knight
    expect(result.controller.state.board[squareFromAlgebraic('a1')]).toBe(
      PIECES.black.knight,
    );
    expect(result.controller.state.turn).toBe('white');
  });

  it('cancels the picker with a board click: no move, selection cleared, play resumes', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: PROMOTION_FEN,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    clickSquare(env, 'a7');
    clickSquare(env, 'a8');
    expect(result.picker.hidden).toBe(false);

    // Clicking the board outside the picker cancels — the gesture never
    // starts a selection or a move.
    firePointer(env, 'pointerdown', pointFor(env, 'e5'));
    firePointer(env, 'pointerup', pointFor(env, 'e5'));

    expect(result.picker.hidden).toBe(true);
    expect(result.controller.pendingPromotion).toBeNull();
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');

    // Play continues: the pawn can be re-selected and promoted later.
    clickSquare(env, 'a7');
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('a7'));
  });

  it('cancels the picker with Escape', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: PROMOTION_FEN,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    clickSquare(env, 'a7');
    clickSquare(env, 'a8');
    expect(result.picker.hidden).toBe(false);

    env.documentListeners['keydown']({ key: 'Escape' });

    expect(result.picker.hidden).toBe(true);
    expect(result.controller.pendingPromotion).toBeNull();
    expect(result.controller.state.board[squareFromAlgebraic('a7')]).toBe(
      PIECES.white.pawn,
    );
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
  });

  it('does not move pieces or change selection while the picker is open', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: PROMOTION_FEN,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    clickSquare(env, 'a7');
    clickSquare(env, 'a8');
    expect(result.picker.hidden).toBe(false);

    // A press on the pawn's own square cancels (outside-the-picker click)
    // but never selects or moves.
    firePointer(env, 'pointerdown', pointFor(env, 'a7'));
    firePointer(env, 'pointerup', pointFor(env, 'a7'));

    expect(result.controller.selection).toBeNull();
    expect(result.controller.pendingPromotion).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.turn).toBe('white');
  });
});

describe('mountBoard: new game', () => {
  it('restarts from the game-over banner: start position, no banner, playable', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    expect(result.banner.hidden).toBe(false);

    result.newGameButton.click();

    expect(result.banner.hidden).toBe(true);
    expect(result.controller.selection).toBeNull();
    expect(result.controller.pendingPromotion).toBeNull();
    expect(result.controller.state.turn).toBe('white');
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.statusLine.textContent).toBe('White to move');

    // No UI state lingers: selecting a White piece shows dots and play runs.
    clickSquare(env, 'e2');
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('e2'));
    clickSquare(env, 'e4');
    expect(toFen(result.controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
  });

  it('restarts mid-game clearing the active selection and its dots', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    // A game in progress with the e2 pawn selected (dots showing).
    clickSquare(env, 'e2');
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('e2'));
    expect(sortedTargets(result.controller.selection)).toEqual([
      squareFromAlgebraic('e3'),
      squareFromAlgebraic('e4'),
    ]);

    result.newGameButton.click();

    expect(result.controller.selection).toBeNull();
    expect(result.controller.state.turn).toBe('white');
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.statusLine.textContent).toBe('White to move');
    expect(result.banner.hidden).toBe(true);
  });

  it('restarts with the promotion picker open: clears pending and picker', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    // a7-a8 leaves a promotion pending (picker open).
    clickSquare(env, 'a7');
    clickSquare(env, 'a8');
    expect(result.controller.pendingPromotion).not.toBeNull();
    expect(result.picker.hidden).toBe(false);

    result.newGameButton.click();

    expect(result.controller.pendingPromotion).toBeNull();
    expect(result.controller.selection).toBeNull();
    expect(result.picker.hidden).toBe(true);
    expect(result.banner.hidden).toBe(true);
    expect(result.controller.state.turn).toBe('white');
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.statusLine.textContent).toBe('White to move');
  });
});

/** The src of the sprite drawn at a canvas position, or undefined. */
function drawnSpriteAt(
  env: ReturnType<typeof createFakeEnvironment>,
  x: number,
  y: number,
): string | undefined {
  const call = env.drawImage.mock.calls.find(
    (args) => args[1] === x && args[2] === y,
  );
  return call === undefined ? undefined : (call[0] as HTMLImageElement).src;
}

describe('mountBoard: move animation', () => {
  it('glides a click-committed pawn and lands exactly on e4', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    // Core commits the moment the move commits — the animation is an overlay.
    expect(result.controller.state.turn).toBe('black');

    // The loop's first frame forces delta 0, so timestamp 1 initializes the
    // clock; the t=126 frame is then 125 ms in (the eased midpoint).
    driver.runFrames([1]); // t≈0: still at e2
    env.drawImage.mockClear();
    driver.runFrames([126]); // t=125: midpoint between e2 (256,384) and e4 (256,256)
    expect(drawnPositions(env)).toContainEqual([256, 320]);
    expect(drawnPositions(env)).not.toContainEqual([256, 384]); // e2
    expect(drawnPositions(env)).not.toContainEqual([256, 256]); // e4
    env.drawImage.mockClear();
    driver.runFrames([251]); // t=250: flight complete — pawn drawn at e4 from core
    expect(drawnPositions(env)).toContainEqual([256, 256]);
    expect(result.animator.isAnimating).toBe(false);
  });

  it('ignores move input while an animation is in flight', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const afterE2E4 =
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    driver.runFrames([1]); // flight active (clock initialized, delta 0)
    expect(result.animator.isAnimating).toBe(true);

    // Mid-animation clicks commit nothing and do not change selection.
    clickSquare(env, 'g1');
    driver.runFrames([126]);
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(afterE2E4);

    // Once the animation completes, input works again — it is Black to
    // move, so selecting a black piece shows the dots.
    driver.runFrames([251]);
    expect(result.animator.isAnimating).toBe(false);
    clickSquare(env, 'g8');
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('g8'));
  });

  it('moves the last-move highlight to the newest committed move', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    driver.runFrames([1, 251]); // let the glide finish (clock + 250 ms)
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e2'),
      to: squareFromAlgebraic('e4'),
    });

    // The opponent replies e7-e5: the highlight moves and e2/e4 are gone.
    clickSquare(env, 'e7');
    clickSquare(env, 'e5');
    driver.runFrames([252, 512]);
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e7'),
      to: squareFromAlgebraic('e5'),
    });
  });

  it('glides king and rook together on a castle', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    clickSquare(env, 'e1');
    clickSquare(env, 'g1');

    // Core committed both pieces immediately.
    expect(result.controller.state.board[squareFromAlgebraic('g1')]).toBe(
      PIECES.white.king,
    );
    expect(result.controller.state.board[squareFromAlgebraic('f1')]).toBe(
      PIECES.white.rook,
    );
    expect(result.animator.flights).toHaveLength(2);

    driver.runFrames([1]);
    env.drawImage.mockClear();
    driver.runFrames([126]); // midpoint of both glides
    expect(drawnSpriteAt(env, 320, 448)).toBe(SPRITE_SOURCES.wK); // e1→g1 mid
    expect(drawnSpriteAt(env, 384, 448)).toBe(SPRITE_SOURCES.wR); // h1→f1 mid
    expect(drawnSpriteAt(env, 256, 448)).toBeUndefined(); // e1 empty
    expect(drawnSpriteAt(env, 448, 448)).toBeUndefined(); // h1 empty
    // The last-move highlight covers the king's origin and destination.
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e1'),
      to: squareFromAlgebraic('g1'),
    });
  });

  it('removes the en-passant pawn from its own square and glides only the capturer', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'd7');
    clickSquare(env, 'd5');
    driver.runFrames([1, 261]); // Black's double-push glide completes

    clickSquare(env, 'e5');
    clickSquare(env, 'd6');
    // At commit time the black pawn is gone from d5 — its own square — and
    // only the capturing pawn is in flight.
    expect(result.controller.state.board[squareFromAlgebraic('d5')]).toBeNull();
    // The capturing pawn lands on d6 (rank 6) — the en-passant target.
    expect(toFen(result.controller.state)).toBe(
      '4k3/8/3P4/8/8/8/8/4K3 b - - 0 2',
    );
    expect(result.animator.flights).toHaveLength(1);
    expect(result.animator.flights[0].from).toBe(squareFromAlgebraic('e5'));
    expect(result.animator.flights[0].to).toBe(squareFromAlgebraic('d6'));
  });

  it('glides the pawn and swaps the sprite to the promoted piece at the end', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '3k4/4P3/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    clickSquare(env, 'e7');
    clickSquare(env, 'e8');
    promotionChoices(result)[0].click(); // queen
    expect(result.controller.state.board[squareFromAlgebraic('e8')]).toBe(
      PIECES.white.queen,
    );

    driver.runFrames([1]);
    env.drawImage.mockClear();
    // Mid-glide: the pawn sprite glides e7 (256,64) → e8 (256,0).
    driver.runFrames([126]);
    expect(drawnSpriteAt(env, 256, 32)).toBe(SPRITE_SOURCES.wP);
    expect(drawnSpriteAt(env, 256, 0)).toBeUndefined(); // destination empty

    // The moment the tween ends, the promoted piece's sprite is on e8.
    env.drawImage.mockClear();
    driver.runFrames([251]);
    expect(drawnSpriteAt(env, 256, 0)).toBe(SPRITE_SOURCES.wQ);
    expect(result.animator.isAnimating).toBe(false);
  });

  it('clears the animation overlay on New game', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    driver.runFrames([0]);
    expect(result.animator.isAnimating).toBe(true);
    expect(result.animator.lastMove).not.toBeNull();

    result.newGameButton.click();
    expect(result.animator.isAnimating).toBe(false);
    expect(result.animator.flights).toHaveLength(0);
    expect(result.animator.lastMove).toBeNull();
    expect(result.animator.checkSquare).toBeNull();
  });
});

describe('mountBoard: check glow', () => {
  it('lights the checked king square red and clears it once the evasion commits', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/5RK1 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    expect(result.animator.checkSquare).toBeNull();

    // Rf1-e1+ delivers check: Black's king e8 glows.
    clickSquare(env, 'f1');
    clickSquare(env, 'e1');
    driver.runFrames([1]);
    expect(result.animator.checkSquare).toBe(squareFromAlgebraic('e8'));

    // Let the glide finish (input unlocks), then Black evades e8-d8.
    driver.runFrames([251]);
    clickSquare(env, 'e8');
    clickSquare(env, 'd8');
    driver.runFrames([252]);
    expect(result.animator.checkSquare).toBeNull();
  });

  it('glows immediately when mounting into a check position', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    driver.runFrames([0]);
    expect(result.animator.checkSquare).toBe(squareFromAlgebraic('e1'));
  });
});

describe('mountBoard: drag snap and sounds', () => {
  const LIVE_KNIGHT_G1 = '4k3/7p/8/8/8/8/8/4K1N1 w - - 0 1';

  it('snaps a drag-dropped move into place without a tween', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    await result.spritesLoaded;
    env.drawImage.mockClear();

    dragPiece(env, 'g1', 'e2');

    // No flight: the snap leaves no tween and the knight is drawn at e2.
    expect(result.animator.isAnimating).toBe(false);
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('g1'),
      to: squareFromAlgebraic('e2'),
    });
    driver.runFrames([0]);
    expect(drawnPositions(env)).toContainEqual([256, 384]); // e2 top-left
    expect(drawnPositions(env)).not.toContainEqual([384, 448]); // g1
  });

  it('plays the move sound on a click-committed move, never on selection', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const moveSound = vi.fn();
    const captureSound = vi.fn();
    mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      sound: { move: moveSound, capture: captureSound },
    });

    clickSquare(env, 'e2'); // selection only — silent
    expect(moveSound).not.toHaveBeenCalled();
    expect(captureSound).not.toHaveBeenCalled();

    clickSquare(env, 'e4'); // commit — move sound
    expect(moveSound).toHaveBeenCalledTimes(1);
    expect(captureSound).not.toHaveBeenCalled();
  });

  it('plays the capture sound when the committed move captures', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const moveSound = vi.fn();
    const captureSound = vi.fn();
    mountBoard(env.container, {
      fen: '4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      sound: { move: moveSound, capture: captureSound },
    });

    clickSquare(env, 'e2');
    clickSquare(env, 'd3');
    expect(captureSound).toHaveBeenCalledTimes(1);
    expect(moveSound).not.toHaveBeenCalled();
  });

  it('plays the correct sound on a drag-dropped snap move', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const moveSound = vi.fn();
    const captureSound = vi.fn();
    mountBoard(env.container, {
      fen: LIVE_KNIGHT_G1,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      sound: { move: moveSound, capture: captureSound },
    });

    dragPiece(env, 'g1', 'e2');
    expect(moveSound).toHaveBeenCalledTimes(1);
    expect(captureSound).not.toHaveBeenCalled();
  });
});

describe('mountBoard: engine mode', () => {
  // Scholar's mate final position: Black (the engine) is checkmated.
  const SCHOLARS_MATE_FEN =
    'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  // White (Ka6, Qb1) mates Black (Ka8) in one with Qb7#.
  const MATE_IN_ONE_FEN = 'k7/8/K7/8/8/8/8/1Q6 w - - 0 1';

  /**
   * A fake engine worker: records every posted search request and lets the
   * test deliver a reply through the same onmessage path the board uses.
   */
  function createFakeEngineWorker(): {
    worker: EngineWorker;
    posted: EngineSearchRequest[];
    reply: (result: EngineSearchResult) => void;
  } {
    const posted: EngineSearchRequest[] = [];
    let onmessage: ((event: MessageEvent<EngineSearchResult>) => void) | null =
      null;
    const worker: EngineWorker = {
      postMessage(message) {
        posted.push(message);
      },
      set onmessage(cb) {
        onmessage = cb;
      },
      get onmessage() {
        return onmessage;
      },
    };
    return {
      worker,
      posted,
      reply(result) {
        onmessage?.({ data: result } as MessageEvent<EngineSearchResult>);
      },
    };
  }

  it('plays a full turn as Black: locks input, shows thinking, applies the reply with animation', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const fake = createFakeEngineWorker();
    const result = mountBoard(env.container, {
      mode: 'engine',
      engineColor: 'black',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      createWorker: () => fake.worker,
    });

    // Engine is Black: no search on mount — it is White to move.
    expect(fake.posted).toHaveLength(0);
    expect(result.statusLine.textContent).toBe('White to move');

    // White commits e2-e4; the engine's turn begins with a search request.
    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0].fen).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(fake.posted[0].depth).toBe(4); // default engine depth
    expect(result.statusLine.textContent).toBe('Engine thinking…');

    // Board input stays locked while the engine thinks.
    clickSquare(env, 'e7');
    expect(result.controller.selection).toBeNull();
    expect(fake.posted).toHaveLength(1);

    // The rAF loop keeps rendering frames while the engine thinks.
    const framesBefore = env.fillRect.mock.calls.length;
    driver.runFrames([0, 16.7, 33.4]);
    expect(env.fillRect.mock.calls.length).toBeGreaterThan(framesBefore);

    // The engine replies e7-e5 through the normal committed-move path:
    // animated, turn returns to White, last-move highlight set.
    fake.reply({
      type: 'search-result',
      requestId: fake.posted[0].requestId,
      move: {
        from: squareFromAlgebraic('e7'),
        to: squareFromAlgebraic('e5'),
      },
      score: 20,
    });
    expect(toFen(result.controller.state)).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    );
    expect(result.statusLine.textContent).toBe('White to move');
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e7'),
      to: squareFromAlgebraic('e5'),
    });
    expect(result.animator.isAnimating).toBe(true);

    // The engine's glide completes and play continues.
    driver.runFrames([300, 560]);
    expect(result.animator.isAnimating).toBe(false);
  });

  it('plays the opening move as White on mount without any player input', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const fake = createFakeEngineWorker();
    const result = mountBoard(env.container, {
      mode: 'engine',
      engineColor: 'white',
      engineDepth: 2,
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      createWorker: () => fake.worker,
    });

    // The engine's first move is dispatched immediately on mount.
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0].fen).toBe(START_TO_FEN);
    expect(fake.posted[0].depth).toBe(2); // injected depth honored
    expect(result.statusLine.textContent).toBe('Engine thinking…');

    fake.reply({
      type: 'search-result',
      requestId: fake.posted[0].requestId,
      move: {
        from: squareFromAlgebraic('e2'),
        to: squareFromAlgebraic('e4'),
      },
      score: 30,
    });
    expect(toFen(result.controller.state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(result.statusLine.textContent).toBe('Black to move');
    expect(result.animator.lastMove).toEqual({
      from: squareFromAlgebraic('e2'),
      to: squareFromAlgebraic('e4'),
    });
  });

  it('never dispatches a search when the game is terminal', () => {
    // Mounting into the scholar-mate final position (engine is Black and
    // checkmated): no search, the game-over banner shows.
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const fake = createFakeEngineWorker();
    const result = mountBoard(env.container, {
      fen: SCHOLARS_MATE_FEN,
      mode: 'engine',
      engineColor: 'black',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      createWorker: () => fake.worker,
    });
    expect(result.banner.hidden).toBe(false);
    expect(fake.posted).toHaveLength(0);

    // A human move that checkmates the engine dispatches nothing either.
    const env2 = createFakeEnvironment();
    const driver2 = createFrameDriver();
    const fake2 = createFakeEngineWorker();
    const result2 = mountBoard(env2.container, {
      fen: MATE_IN_ONE_FEN,
      mode: 'engine',
      engineColor: 'black',
      createImage: env2.createImage,
      requestFrame: driver2.requestFrame,
      cancelFrame: driver2.cancelFrame,
      createWorker: () => fake2.worker,
    });
    clickSquare(env2, 'b1');
    clickSquare(env2, 'b7');
    expect(fake2.posted).toHaveLength(0);
    expect(result2.banner.hidden).toBe(false);
    expect(result2.banner.textContent).toBe('Checkmate — White wins');
  });

  it('cancels an in-flight search on New game: a late stale reply never moves pieces', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const fake = createFakeEngineWorker();
    const result = mountBoard(env.container, {
      mode: 'engine',
      engineColor: 'black',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
      createWorker: () => fake.worker,
    });

    clickSquare(env, 'e2');
    clickSquare(env, 'e4');
    expect(fake.posted).toHaveLength(1);
    expect(result.statusLine.textContent).toBe('Engine thinking…');

    // New game while the search is in flight.
    result.newGameButton.click();
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.statusLine.textContent).toBe('White to move');

    // A late reply carrying the superseded requestId is dropped: no piece
    // moves in the fresh game.
    fake.reply({
      type: 'search-result',
      requestId: fake.posted[0].requestId,
      move: {
        from: squareFromAlgebraic('e7'),
        to: squareFromAlgebraic('e5'),
      },
      score: 20,
    });
    expect(toFen(result.controller.state)).toBe(START_TO_FEN);
    expect(result.statusLine.textContent).toBe('White to move');
    expect(result.controller.selection).toBeNull();
  });
});
