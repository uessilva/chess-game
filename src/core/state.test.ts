import { describe, expect, it } from 'vitest';

import { square, squareFromAlgebraic } from './board';
import { initialState } from './state';
import { PIECES } from './types';

describe('initialState', () => {
  it('sets up the standard starting position', () => {
    const state = initialState();

    expect(state.board[squareFromAlgebraic('e1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('d1')]).toBe(PIECES.white.queen);
    expect(state.board[squareFromAlgebraic('a1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('h1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('e8')]).toBe(PIECES.black.king);
    expect(state.board[squareFromAlgebraic('d8')]).toBe(PIECES.black.queen);
    for (let file = 0; file < 8; file++) {
      expect(state.board[square(file, 1)]).toBe(PIECES.white.pawn);
      expect(state.board[square(file, 6)]).toBe(PIECES.black.pawn);
    }

    // Empty middle ranks and off-board cells.
    expect(state.board[squareFromAlgebraic('e4')]).toBeNull();
    expect(state.board[squareFromAlgebraic('a5')]).toBeNull();
    expect(state.board[0x08]).toBeNull();
  });

  it('starts with white to move, full rights, and zeroed counters', () => {
    const state = initialState();

    expect(state.turn).toBe('white');
    expect(state.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    });
    expect(state.enPassant).toBeNull();
    expect(state.halfmoveClock).toBe(0);
    expect(state.fullmoveNumber).toBe(1);
    expect(state.history).toEqual([]);
  });
});
