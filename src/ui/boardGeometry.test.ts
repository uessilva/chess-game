import { describe, expect, it } from 'vitest';

import { square, squareFromAlgebraic } from '../core';
import { pixelToSquare, squareToPixel } from './boardGeometry';

const SIZES = [1, 3, 64, 100];

describe('squareToPixel / pixelToSquare round-trip', () => {
  it('round-trips all 64 squares for both orientations and any size >= 1', () => {
    for (const orientation of ['white', 'black'] as const) {
      for (const squareSize of SIZES) {
        for (let rank = 0; rank < 8; rank++) {
          for (let file = 0; file < 8; file++) {
            const sq = square(file, rank);
            const { x, y } = squareToPixel(sq, squareSize, orientation);
            expect(pixelToSquare(x, y, squareSize, orientation)).toBe(sq);
          }
        }
      }
    }
  });

  it('round-trips at every point inside the square, not just the corner', () => {
    const squareSize = 32;
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = square(file, rank);
        const { x, y } = squareToPixel(sq, squareSize, 'white');
        for (const dx of [0, 10, 31]) {
          for (const dy of [0, 10, 31]) {
            expect(pixelToSquare(x + dx, y + dy, squareSize, 'white')).toBe(sq);
          }
        }
      }
    }
  });
});

describe('squareToPixel', () => {
  it('puts a1 at the bottom-left with the default white orientation', () => {
    expect(squareToPixel(squareFromAlgebraic('a1'), 64)).toEqual({
      x: 0,
      y: 448,
    });
    expect(squareToPixel(squareFromAlgebraic('h1'), 64)).toEqual({
      x: 448,
      y: 448,
    });
    expect(squareToPixel(squareFromAlgebraic('a8'), 64)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('mirrors the board with black at the bottom', () => {
    const size = 64;
    expect(squareToPixel(squareFromAlgebraic('a1'), size, 'black')).toEqual({
      x: 448,
      y: 0,
    });
    expect(squareToPixel(squareFromAlgebraic('h8'), size, 'black')).toEqual({
      x: 0,
      y: 448,
    });
    expect(squareToPixel(squareFromAlgebraic('a8'), size, 'black')).toEqual({
      x: 448,
      y: 448,
    });
  });
});

describe('pixelToSquare', () => {
  it('returns the square under a pixel at its center', () => {
    const size = 64;
    expect(pixelToSquare(4.5 * size, 4.5 * size, size)).toBe(
      squareFromAlgebraic('e4'),
    );
    expect(pixelToSquare(0.5 * size, 0.5 * size, size)).toBe(
      squareFromAlgebraic('a8'),
    );
    expect(pixelToSquare(7.5 * size, 7.5 * size, size)).toBe(
      squareFromAlgebraic('h1'),
    );
  });

  it('returns null for pixels outside the board bounds', () => {
    const size = 64;
    // 1px above the board's top edge
    expect(pixelToSquare(100, -1, size)).toBeNull();
    // 1px left of the board's left edge
    expect(pixelToSquare(-1, 100, size)).toBeNull();
    // exactly on the right and bottom edges
    expect(pixelToSquare(8 * size, 100, size)).toBeNull();
    expect(pixelToSquare(100, 8 * size, size)).toBeNull();
    // far outside in every direction
    expect(pixelToSquare(-500, -500, size)).toBeNull();
    expect(pixelToSquare(10_000, 10_000, size)).toBeNull();
  });

  it('returns the square under a pixel for the black orientation too', () => {
    const size = 64;
    expect(pixelToSquare(0.5 * size, 0.5 * size, size, 'black')).toBe(
      squareFromAlgebraic('h1'),
    );
    expect(pixelToSquare(7.5 * size, 7.5 * size, size, 'black')).toBe(
      squareFromAlgebraic('a8'),
    );
  });

  it('rejects a non-positive square size', () => {
    expect(() => pixelToSquare(0, 0, 0)).toThrow(/positive/);
    expect(() => pixelToSquare(0, 0, -1)).toThrow(/positive/);
  });
});
