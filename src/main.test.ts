import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountBoard } from './main';
import { toFen, squareFromAlgebraic } from './core';
import { squareToPixel, SPRITE_SOURCES } from './ui';

function createFakeEnvironment(failSources: Set<string> = new Set()): {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  createImage: () => HTMLImageElement;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  statusLine: HTMLElement & { textContent: string };
  listeners: Record<string, (event: unknown) => void>;
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
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      listeners[type] = cb;
    }),
    getBoundingClientRect: vi.fn(() => ({
      left: 0,
      top: 0,
      right: 512,
      bottom: 512,
      width: 512,
      height: 512,
    })),
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

/** Canvas pixel at the center of a square (white orientation, 64px squares). */
function clickPointFor(algebraic: string): {
  clientX: number;
  clientY: number;
} {
  const { x, y } = squareToPixel(squareFromAlgebraic(algebraic), 64, 'white');
  return { clientX: x + 32, clientY: y + 32 };
}

function fireClick(
  env: ReturnType<typeof createFakeEnvironment>,
  point: { clientX: number; clientY: number },
): void {
  const listener = env.listeners.click;
  if (listener === undefined) {
    throw new Error('no click listener attached');
  }
  listener(point);
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

    fireClick(env, clickPointFor('e2'));
    driver.runFrames([0]);
    expect(result.controller.selection?.from).toBe(squareFromAlgebraic('e2'));

    fireClick(env, clickPointFor('e4'));
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

    fireClick(env, clickPointFor('b8'));
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

    fireClick(env, clickPointFor('e2'));
    driver.runFrames([0]);
    expect(result.controller.selection).not.toBeNull();

    fireClick(env, clickPointFor('e5'));
    driver.runFrames([16.7]);

    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(env.statusLine.textContent).toBe('White to move');
  });

  it('stops the game loop on demand', () => {
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

    fireClick(env, clickPointFor('e2'));
    driver.runFrames([0, 16.7]);

    // The loop is stopped: the click intent never reaches the controller.
    expect(result.controller.selection).toBeNull();
    expect(toFen(result.controller.state)).toBe(before);
    expect(env.statusLine.textContent).toBe('White to move');
  });
});
