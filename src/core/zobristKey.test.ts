import { describe, expect, it } from 'vitest';

import { squareFromAlgebraic } from './board';
import { generateLegalMoves } from './legality';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import { initialState } from './state';
import type { Move } from './types';
import { zobristHash } from './zobrist';

/**
 * Task 3.5 invariant tests (#20): `BoardState.zobristKey` is maintained
 * incrementally by makeMove/unmakeMove and must equal the reference
 * implementation `zobristHash(state)` at every position. This is the
 * correctness contract the engine's transposition table keys on — if the
 * maintained key ever drifted, TT probes would silently miss (or worse,
 * collide onto the wrong position).
 */

/** Start a legal move from `from` to `to` on `state` (returns the Move). */
function legalMove(state: BoardState, from: string, to: string): Move {
  const move = generateLegalMoves(state).find(
    (m) =>
      m.from === squareFromAlgebraic(from) && m.to === squareFromAlgebraic(to),
  );
  if (move === undefined) {
    throw new Error(`no legal move ${from}->${to}`);
  }
  return move;
}

describe('BoardState.zobristKey', () => {
  it('is seeded equal to zobristHash by initialState and parseFen', () => {
    const initial = initialState();
    expect(initial.zobristKey).toBe(zobristHash(initial));
    expect(initial.zobristKey).toBe(initial.positionHashes[0]);
  });

  it('tracks zobristHash through a scripted game covering every mechanic', () => {
    const state = initialState();
    // Every move below is verified legal by the test harness, and the
    // sequence covers a double push (ep window), a meaningful en-passant
    // capture, castling on both sides, a plain capture, a recapture, and
    // a capture-promotion.
    const script: readonly { from: string; to: string }[] = [
      { from: 'e2', to: 'e4' }, // double push: ep window e3
      { from: 'c7', to: 'c5' }, // leaves e4 free to advance
      { from: 'e4', to: 'e5' }, // white pawn beside the future ep target
      { from: 'd7', to: 'd5' }, // double push: meaningful ep target d6
      { from: 'e5', to: 'd6' }, // en-passant capture (CAPTURE | EN_PASSANT)
      { from: 'g8', to: 'f6' },
      { from: 'g1', to: 'f3' },
      { from: 'b8', to: 'c6' },
      { from: 'f1', to: 'b5' }, // clears f1 for castling
      { from: 'e7', to: 'e6' }, // clears e7 for the bishop
      { from: 'd2', to: 'd4' },
      { from: 'f8', to: 'e7' }, // clears f8 for castling
      { from: 'e1', to: 'g1' }, // white castles kingside
      { from: 'e8', to: 'g8' }, // black castles kingside
      { from: 'b5', to: 'c6' }, // bishop takes knight (capture)
      { from: 'b7', to: 'c6' }, // pawn recaptures (capture)
      { from: 'd6', to: 'd7' }, // pawn push toward the 8th rank
      { from: 'a7', to: 'a6' },
      { from: 'd7', to: 'c8' }, // capture-promotion (CAPTURE | PROMOTION)
    ];
    for (const { from, to } of script) {
      makeMove(state, legalMove(state, from, to));
      expect(state.zobristKey, `after ${from}->${to}`).toBe(zobristHash(state));
      expect(state.zobristKey, `after ${from}->${to}`).toBe(
        state.positionHashes[state.positionHashes.length - 1],
      );
    }
  });

  it('restores the exact previous key on unmake, in reverse order', () => {
    const state = initialState();
    const script: readonly { from: string; to: string }[] = [
      { from: 'e2', to: 'e4' },
      { from: 'd7', to: 'd5' },
      { from: 'e4', to: 'd5' }, // capture
      { from: 'g8', to: 'f6' },
      { from: 'g1', to: 'f3' },
    ];
    const keys: bigint[] = [state.zobristKey];
    for (const { from, to } of script) {
      makeMove(state, legalMove(state, from, to));
      keys.push(state.zobristKey);
    }
    for (let i = script.length; i > 0; i--) {
      unmakeMove(state);
      expect(state.zobristKey, `unmake #${i}`).toBe(keys[i - 1]);
      expect(state.zobristKey, `unmake #${i}`).toBe(zobristHash(state));
    }
    expect(state.zobristKey).toBe(keys[0]);
  });

  it('round-trips the exact key through a full make/unmake cycle', () => {
    const state = initialState();
    const snapshot = structuredClone(state);
    for (const { from, to } of [
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e5' },
      { from: 'g1', to: 'f3' },
      { from: 'b8', to: 'c6' },
      { from: 'f1', to: 'c4' },
    ]) {
      makeMove(state, legalMove(state, from, to));
    }
    expect(state.zobristKey).toBe(zobristHash(state));
    expect(state.zobristKey).not.toBe(snapshot.zobristKey);
    for (let i = 0; i < 5; i++) {
      unmakeMove(state);
    }
    expect(state).toEqual(snapshot);
    expect(state.zobristKey).toBe(snapshot.zobristKey);
  });

  it('agrees with zobristHash on a meaningless en-passant window', () => {
    // 1.e4 leaves the e3 window, but no black pawn can capture en passant,
    // so the position hashes like the same placement with no ep square.
    const state = initialState();
    makeMove(state, legalMove(state, 'e2', 'e4'));
    expect(state.zobristKey).toBe(zobristHash(state));
    const withoutEp = structuredClone(state);
    withoutEp.enPassant = null;
    withoutEp.zobristKey = zobristHash(withoutEp);
    expect(state.zobristKey).toBe(withoutEp.zobristKey);
  });

  it('is identical for two move orders that reach the same position', () => {
    // 1. e4 e5 2. Nf3 vs 1. Nf3 e5 2. e4: the transposition the TT relies
    // on — equal keys mean the engine can reuse the subtree.
    const first = initialState();
    for (const { from, to } of [
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e5' },
      { from: 'g1', to: 'f3' },
    ]) {
      makeMove(first, legalMove(first, from, to));
    }
    const second = initialState();
    for (const { from, to } of [
      { from: 'g1', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'e2', to: 'e4' },
    ]) {
      makeMove(second, legalMove(second, from, to));
    }
    expect(second.zobristKey).toBe(first.zobristKey);
    expect(second.zobristKey).toBe(zobristHash(first));
  });
});
