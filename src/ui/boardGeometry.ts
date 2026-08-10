import { fileOf, rankOf, square } from '../core';
import type { Square } from '../core';

/**
 * Which color sits at the bottom edge of the board. `'white'` (the default)
 * puts White's home rank — rank 1 — at the bottom.
 */
export type BoardOrientation = 'white' | 'black';

/** Default side length of one square, in px. */
export const DEFAULT_SQUARE_SIZE = 64;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Map a 0x88 square to the top-left corner of its canvas cell. Pure math —
 * no DOM, canvas, or Image — so this module runs in Vitest's default node
 * environment.
 */
export function squareToPixel(
  sq: Square,
  squareSize: number,
  orientation: BoardOrientation = 'white',
): Point {
  const file = fileOf(sq);
  const rank = rankOf(sq);
  if (orientation === 'black') {
    return { x: (7 - file) * squareSize, y: rank * squareSize };
  }
  return { x: file * squareSize, y: (7 - rank) * squareSize };
}

/**
 * Map a canvas pixel to the 0x88 square it covers, or `null` when the point
 * falls outside the 8x8 board.
 */
export function pixelToSquare(
  x: number,
  y: number,
  squareSize: number,
  orientation: BoardOrientation = 'white',
): Square | null {
  if (squareSize <= 0) {
    throw new Error('squareSize must be positive');
  }
  const file = Math.floor(x / squareSize);
  const rank = Math.floor(y / squareSize);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    return null;
  }
  const boardFile = orientation === 'black' ? 7 - file : file;
  const boardRank = orientation === 'black' ? rank : 7 - rank;
  return square(boardFile, boardRank);
}
