import { describe, expect, it } from 'vitest';

import {
  algebraicOf,
  BOARD_SIZE,
  emptyBoard,
  fileOf,
  isOnBoard,
  rankOf,
  square,
  squareFromAlgebraic,
} from './board';

describe('0x88 indexing', () => {
  it('round-trips file/rank for all 64 squares', () => {
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = square(file, rank);
        expect(isOnBoard(sq)).toBe(true);
        expect(fileOf(sq)).toBe(file);
        expect(rankOf(sq)).toBe(rank);
      }
    }
  });

  it('places a1 at 0x00 and h8 at 0x77', () => {
    expect(square(0, 0)).toBe(0x00);
    expect(square(7, 7)).toBe(0x77);
  });

  it('detects off-board squares with a single AND', () => {
    for (const sq of [0x08, 0x18, 0x80, 0x88, 0xf8, -1, 128]) {
      expect(isOnBoard(sq)).toBe(false);
    }
  });
});

describe('algebraic notation', () => {
  it('parses squares', () => {
    expect(squareFromAlgebraic('a1')).toBe(square(0, 0));
    expect(squareFromAlgebraic('e4')).toBe(square(4, 3));
    expect(squareFromAlgebraic('h8')).toBe(square(7, 7));
  });

  it('rejects invalid squares', () => {
    for (const bad of ['i1', 'a0', 'a9', 'e', 'e44', 'A1', '']) {
      expect(() => squareFromAlgebraic(bad)).toThrow(/invalid square/);
    }
  });

  it('formats squares', () => {
    expect(algebraicOf(square(0, 0))).toBe('a1');
    expect(algebraicOf(square(4, 3))).toBe('e4');
    expect(algebraicOf(square(7, 7))).toBe('h8');
  });

  it('round-trips all 64 squares', () => {
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = square(file, rank);
        expect(squareFromAlgebraic(algebraicOf(sq))).toBe(sq);
      }
    }
  });
});

describe('emptyBoard', () => {
  it('is 128 null cells', () => {
    const board = emptyBoard();
    expect(board).toHaveLength(BOARD_SIZE);
    expect(board.every((cell) => cell === null)).toBe(true);
  });
});
