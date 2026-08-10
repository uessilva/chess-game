import { describe, expect, it, vi } from 'vitest';

import { PIECES } from '../core';
import type { PieceType } from '../core';
import {
  preloadSprites,
  SPRITE_KEYS,
  SPRITE_SOURCES,
  spriteKeyFor,
} from './sprites';

/**
 * createImage stub that behaves like a browser Image: preload sets `src`
 * before calling `decode()`, so the stub decides success/failure per asset.
 */
function stubImageFactory(failSources: Set<string>): {
  createImage: () => HTMLImageElement;
  images: HTMLImageElement[];
} {
  const images: HTMLImageElement[] = [];
  const createImage = () => {
    const decode = vi.fn(() => Promise.resolve());
    const img = { src: '', decode } as unknown as HTMLImageElement;
    decode.mockImplementation(() =>
      failSources.has(img.src)
        ? Promise.reject(new Error(`boom: ${img.src}`))
        : Promise.resolve(),
    );
    images.push(img);
    return img;
  };
  return { createImage, images };
}

describe('spriteKeyFor', () => {
  it('maps all 12 piece/color combinations to 12 distinct keys', () => {
    const keys = new Set<string>();
    const types = Object.keys(PIECES.white) as PieceType[];
    for (const color of ['white', 'black'] as const) {
      for (const type of types) {
        const key = spriteKeyFor(PIECES[color][type]);
        expect(key).toBeDefined();
        keys.add(key);
      }
    }
    expect(keys.size).toBe(12);
  });

  it('spot-checks the expected key names', () => {
    expect(spriteKeyFor(PIECES.white.king)).toBe('wK');
    expect(spriteKeyFor(PIECES.white.rook)).toBe('wR');
    expect(spriteKeyFor(PIECES.white.pawn)).toBe('wP');
    expect(spriteKeyFor(PIECES.black.queen)).toBe('bQ');
    expect(spriteKeyFor(PIECES.black.knight)).toBe('bN');
    expect(spriteKeyFor(PIECES.black.bishop)).toBe('bB');
  });
});

describe('SPRITE_SOURCES', () => {
  it('has exactly one non-empty .svg source per sprite key', () => {
    expect(new Set(Object.keys(SPRITE_SOURCES))).toEqual(new Set(SPRITE_KEYS));
    for (const key of SPRITE_KEYS) {
      expect(SPRITE_SOURCES[key]).toMatch(/^\/pieces\/[wb][KQRBNP]\.svg$/);
    }
  });
});

describe('preloadSprites', () => {
  it('resolves with all 12 sprites once every asset decodes', async () => {
    const { createImage, images } = stubImageFactory(new Set());
    const map = await preloadSprites(createImage);

    expect(images).toHaveLength(12);
    expect(Object.keys(map)).toHaveLength(12);
    for (const key of SPRITE_KEYS) {
      expect(map[key]).toBeDefined();
      expect(map[key]!.src).toBe(SPRITE_SOURCES[key]);
    }
  });

  it('rejects naming the failing asset when one decode fails', async () => {
    const { createImage } = stubImageFactory(new Set([SPRITE_SOURCES.wQ]));
    await expect(preloadSprites(createImage)).rejects.toThrow(/wQ/);
    await expect(preloadSprites(createImage)).rejects.toThrow(
      /pieces\/wQ\.svg/,
    );
  });
});
