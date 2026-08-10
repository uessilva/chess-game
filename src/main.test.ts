import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountBoard } from './main';
import { SPRITE_SOURCES } from './ui';

function createFakeEnvironment(failSources: Set<string> = new Set()): {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  createImage: () => HTMLImageElement;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
} {
  const fillRect = vi.fn();
  const drawImage = vi.fn();
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
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;

  vi.stubGlobal('document', {
    createElement: vi.fn(() => canvas),
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

  return { canvas, container, createImage, fillRect, drawImage };
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
