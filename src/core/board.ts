import type { Piece, Square } from './types';

/**
 * 0x88 board: a 128-cell array indexed by `(rank << 4) | file`, with
 * rank 0 = rank 1 (White's back rank) and file 0 = the a-file. The high
 * bit of each nibble flags off-board squares, so one AND — `sq & 0x88` —
 * detects when a move direction runs off an edge. Move generation (1.5)
 * leans on that test heavily.
 */

export const BOARD_SIZE = 128;

export function square(file: number, rank: number): Square {
  return (rank << 4) | file;
}

export function fileOf(sq: Square): number {
  return sq & 7;
}

export function rankOf(sq: Square): number {
  return sq >> 4;
}

export function isOnBoard(sq: Square): boolean {
  return (sq & 0x88) === 0;
}

const FILES = 'abcdefgh';

export function squareFromAlgebraic(alg: string): Square {
  if (!/^[a-h][1-8]$/.test(alg)) {
    throw new Error(`invalid square: "${alg}"`);
  }
  return square(FILES.indexOf(alg[0]), alg.charCodeAt(1) - '1'.charCodeAt(0));
}

export function algebraicOf(sq: Square): string {
  return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

export function emptyBoard(): (Piece | null)[] {
  return new Array<Piece | null>(BOARD_SIZE).fill(null);
}
