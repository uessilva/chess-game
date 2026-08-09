import { describe, expect, it } from 'vitest';

import { parseFen, START_FEN } from './fen';
import { divide, perft } from './index';
import { initialState } from './state';

const FOOLSMATE_FEN =
  'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const PROMOTION_FEN = '7k/P7/8/8/8/8/8/K7 w - - 0 1';

describe('perft', () => {
  it('is exported from src/core', () => {
    expect(perft).toBeTypeOf('function');
    expect(divide).toBeTypeOf('function');
  });

  it('counts the depth-0 base case as a single leaf node', () => {
    expect(perft(START_FEN, 0)).toBe(1);
  });

  it('accepts a FEN string', () => {
    expect(perft(START_FEN, 1)).toBe(20);
  });

  it('accepts a BoardState (parsed or freshly built)', () => {
    expect(perft(parseFen(START_FEN), 1)).toBe(20);
    expect(perft(initialState(), 1)).toBe(20);
  });

  it('counts zero for a checkmate position at any depth', () => {
    expect(perft(FOOLSMATE_FEN, 1)).toBe(0);
    expect(perft(FOOLSMATE_FEN, 2)).toBe(0);
  });

  it('leaves a passed BoardState exactly as found', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    perft(state, 3);
    expect(state).toEqual(snapshot);
  });

  it('throws the descriptive parseFen error for a malformed FEN', () => {
    expect(() => perft('not a fen at all', 1)).toThrow(/invalid FEN/);
    expect(() => perft('8/8/8/8/8/8/8/8 w - - 0 1', 1)).toThrow(
      /invalid FEN: expected exactly one king per side/,
    );
  });

  it('rejects a negative depth instead of silently returning a leaf', () => {
    expect(() => perft(START_FEN, -1)).toThrow(/depth must be a non-negative/);
  });

  it('rejects a fractional depth instead of silently truncating', () => {
    expect(() => perft(START_FEN, 1.5)).toThrow(/depth must be a non-negative/);
  });
});

describe('divide', () => {
  it('lists one entry per legal move with its leaf count at depth 1', () => {
    const counts = divide(START_FEN, 1);
    expect(counts.size).toBe(20);
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
  });

  it('sums to the same total as perft at every fast depth', () => {
    for (const depth of [1, 2, 3]) {
      const counts = divide(START_FEN, depth);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(perft(START_FEN, depth));
    }
  });

  it('keys moves as algebraic from->to pairs', () => {
    const counts = divide(START_FEN, 1);
    expect(counts.has('e2->e4')).toBe(true);
    expect(counts.has('e2->e3')).toBe(true);
    expect(counts.has('g1->f3')).toBe(true);
    expect(counts.has('b1->c3')).toBe(true);
  });

  it('keeps the four promotion variants distinct with a piece suffix', () => {
    const counts = divide(PROMOTION_FEN, 1);
    expect(counts.get('a7->a8=q')).toBe(1);
    expect(counts.get('a7->a8=r')).toBe(1);
    expect(counts.get('a7->a8=b')).toBe(1);
    expect(counts.get('a7->a8=n')).toBe(1);
    expect(counts.size).toBe(7); // four promotions + three king moves
  });

  it('returns an empty map at depth 0', () => {
    expect(divide(START_FEN, 0).size).toBe(0);
  });

  it('returns an empty map when the side to move has no legal moves', () => {
    expect(divide(FOOLSMATE_FEN, 1).size).toBe(0);
  });

  it('accepts a BoardState and leaves it exactly as found', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    divide(state, 2);
    expect(state).toEqual(snapshot);
  });

  it('throws the descriptive parseFen error for a malformed FEN', () => {
    expect(() => divide('bogus', 1)).toThrow(/invalid FEN/);
  });

  it('rejects a negative or fractional depth', () => {
    expect(() => divide(START_FEN, -1)).toThrow(/depth must be a non-negative/);
    expect(() => divide(START_FEN, 2.5)).toThrow(
      /depth must be a non-negative/,
    );
  });
});
