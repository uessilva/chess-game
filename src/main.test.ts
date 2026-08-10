import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountBoard } from './main';
import { algebraicOf, squareFromAlgebraic, toFen } from './core';
import { LIFT_OFFSET, squareToPixel, SPRITE_SOURCES } from './ui';
import type { BoardOrientation } from './ui';

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function createFakeEnvironment(failSources: Set<string> = new Set()): {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  createImage: () => HTMLImageElement;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  statusLine: HTMLElement & { textContent: string };
  listeners: Record<string, (event: unknown) => void>;
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
  } as unknown as CanvasRenderingContext2D;

  const listeners: Record<string, (event: unknown) => void> = {};
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

  const statusLine = {
    className: '',
    textContent: '',
  } as unknown as HTMLElement & {
    textContent: string;
  };

  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) =>
      tag === 'canvas' ? canvas : statusLine,
    ),
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
    mountBoard(env.container, {
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    expect(env.statusLine.textContent).toBe('White to move');
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
    expect(env.statusLine.textContent).toBe('Black to move');
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
    expect(env.statusLine.textContent).toBe('White to move');
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
    expect(env.statusLine.textContent).toBe('White to move');
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
    expect(env.statusLine.textContent).toBe('White to move');
  });
});

describe('mountBoard: drag-and-drop', () => {
  it('drags a knight to a legal square, lands it, and passes the turn', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    dragPiece(env, 'g1', 'e2');
    driver.runFrames([0]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(
      '4k3/8/8/8/8/8/4N3/4K3 b - - 1 1',
    );
    expect(env.statusLine.textContent).toBe('Black to move');
  });

  it('renders the lifted piece following the pointer and its origin square empty', async () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1',
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
    // 416) plus the lift offset. The two kings still draw on their squares.
    expect(drawnPositions(env)).toContainEqual([
      288 - 32 + LIFT_OFFSET.x,
      416 - 32 + LIFT_OFFSET.y,
    ]);
    expect(drawnPositions(env)).toContainEqual([256, 448]); // e1 king
    expect(env.drawImage).toHaveBeenCalledTimes(3);
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
    expect(env.statusLine.textContent).toBe('Black to move');
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
      fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1',
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
      fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1',
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
      fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });

    dragPiece(env, 'g1', 'e2');
    firePointer(env, 'lostpointercapture');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(
      '4k3/8/8/8/8/8/4N3/4K3 b - - 1 1',
    );
  });

  it('does not silently promote when a pawn is dropped on the last rank', () => {
    const env = createFakeEnvironment();
    const driver = createFrameDriver();
    const result = mountBoard(env.container, {
      fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
      createImage: env.createImage,
      requestFrame: driver.requestFrame,
      cancelFrame: driver.cancelFrame,
    });
    const before = toFen(result.controller.state);

    dragPiece(env, 'a7', 'a8');
    driver.runFrames([0]);

    expect(toFen(result.controller.state)).toBe(before);
    expect(result.controller.state.board[squareFromAlgebraic('a8')]).toBeNull();
    expect(result.controller.state.turn).toBe('white');
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
