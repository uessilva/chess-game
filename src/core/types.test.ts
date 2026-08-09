import { describe, expect, it } from 'vitest';

import { MoveFlags, opposite, PIECES } from './types';
import type { PieceType } from './types';

describe('opposite', () => {
  it('flips white to black and back', () => {
    expect(opposite('white')).toBe('black');
    expect(opposite('black')).toBe('white');
  });
});

describe('PIECES', () => {
  it('provides 12 frozen singletons with the right color and type', () => {
    const colors = ['white', 'black'] as const;
    const types: PieceType[] = [
      'pawn',
      'knight',
      'bishop',
      'rook',
      'queen',
      'king',
    ];
    for (const color of colors) {
      for (const type of types) {
        expect(PIECES[color][type]).toEqual({ color, type });
        expect(Object.isFrozen(PIECES[color][type])).toBe(true);
      }
    }
  });
});

describe('MoveFlags', () => {
  it('are distinct single bits', () => {
    const values = Object.values(MoveFlags);
    const combined = values.reduce((acc, bit) => acc | bit, 0);
    expect(combined).toBe((1 << values.length) - 1);
    for (const bit of values) {
      expect(bit & (bit - 1)).toBe(0);
    }
  });
});
