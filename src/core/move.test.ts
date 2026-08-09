import { describe, expect, it } from 'vitest';

import { emptyBoard, squareFromAlgebraic } from './board';
import { makeMove, unmakeMove } from './move';
import type { BoardState, CastlingRights } from './state';
import { initialState } from './state';
import type { Move, Piece, PieceType } from './types';
import { MoveFlags, PIECES } from './types';

const NO_RIGHTS: CastlingRights = {
  whiteKingside: false,
  whiteQueenside: false,
  blackKingside: false,
  blackQueenside: false,
};

const ALL_RIGHTS: CastlingRights = {
  whiteKingside: true,
  whiteQueenside: true,
  blackKingside: true,
  blackQueenside: true,
};

/** Build a sparse position directly from square → piece entries. */
function craftedState(
  pieces: Record<string, Piece>,
  overrides: Partial<BoardState> = {},
): BoardState {
  const state: BoardState = {
    board: emptyBoard(),
    turn: 'white',
    castling: { ...NO_RIGHTS },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    positionHashes: [],
    ...overrides,
  };
  for (const [alg, piece] of Object.entries(pieces)) {
    state.board[squareFromAlgebraic(alg)] = piece;
  }
  return state;
}

function mv(
  from: string,
  to: string,
  piece: PieceType,
  flags = 0,
  promotion?: PieceType,
): Move {
  return {
    from: squareFromAlgebraic(from),
    to: squareFromAlgebraic(to),
    piece,
    flags,
    promotion,
  };
}

describe('makeMove', () => {
  it('makes a quiet move and flips the side to move', () => {
    const state = initialState();
    makeMove(state, mv('g1', 'f3', 'knight'));

    expect(state.board[squareFromAlgebraic('f3')]).toBe(PIECES.white.knight);
    expect(state.board[squareFromAlgebraic('g1')]).toBeNull();
    expect(state.turn).toBe('black');
    expect(state.halfmoveClock).toBe(1);
    expect(state.fullmoveNumber).toBe(1);
    expect(state.enPassant).toBeNull();
    expect(state.castling).toEqual(ALL_RIGHTS);
    expect(state.history).toHaveLength(1);
  });

  it('removes the captured piece and resets the halfmove clock', () => {
    const state = craftedState(
      { e4: PIECES.white.pawn, d5: PIECES.black.knight },
      { halfmoveClock: 3 },
    );
    makeMove(state, mv('e4', 'd5', 'pawn', MoveFlags.CAPTURE));

    expect(state.board[squareFromAlgebraic('d5')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('e4')]).toBeNull();
    expect(state.halfmoveClock).toBe(0);
  });

  it('sets the en-passant square on a double push, clears it afterwards', () => {
    const state = initialState();
    makeMove(state, mv('e2', 'e4', 'pawn', MoveFlags.DOUBLE_PUSH));

    expect(state.board[squareFromAlgebraic('e4')]).toBe(PIECES.white.pawn);
    expect(state.enPassant).toBe(squareFromAlgebraic('e3'));
    expect(state.halfmoveClock).toBe(0);

    makeMove(state, mv('a7', 'a6', 'pawn'));
    expect(state.enPassant).toBeNull();
  });

  it('removes the passed pawn on an en-passant capture', () => {
    const state = craftedState(
      { e5: PIECES.white.pawn, d5: PIECES.black.pawn },
      { enPassant: squareFromAlgebraic('d6') },
    );
    makeMove(
      state,
      mv('e5', 'd6', 'pawn', MoveFlags.CAPTURE | MoveFlags.EN_PASSANT),
    );

    expect(state.board[squareFromAlgebraic('d6')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('d5')]).toBeNull();
    expect(state.board[squareFromAlgebraic('e5')]).toBeNull();
    expect(state.enPassant).toBeNull();
  });

  it.each(['queen', 'rook', 'bishop', 'knight'] as const)(
    'promotes a pawn to %s',
    (promotion) => {
      const state = craftedState({ a7: PIECES.white.pawn });
      makeMove(state, mv('a7', 'a8', 'pawn', MoveFlags.PROMOTION, promotion));

      expect(state.board[squareFromAlgebraic('a8')]).toBe(
        PIECES.white[promotion],
      );
      expect(state.board[squareFromAlgebraic('a7')]).toBeNull();
    },
  );

  it('promotes while capturing', () => {
    const state = craftedState(
      { b7: PIECES.white.pawn, a8: PIECES.black.rook },
      { castling: { ...ALL_RIGHTS } },
    );
    makeMove(
      state,
      mv('b7', 'a8', 'pawn', MoveFlags.CAPTURE | MoveFlags.PROMOTION, 'queen'),
    );

    expect(state.board[squareFromAlgebraic('a8')]).toBe(PIECES.white.queen);
    // The a8 rook was captured, so black loses queenside rights.
    expect(state.castling.blackQueenside).toBe(false);
  });

  it('castles kingside, moving the rook alongside the king', () => {
    const state = craftedState(
      { e1: PIECES.white.king, h1: PIECES.white.rook },
      { castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv('e1', 'g1', 'king', MoveFlags.CASTLE_KING));

    expect(state.board[squareFromAlgebraic('g1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('f1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('e1')]).toBeNull();
    expect(state.board[squareFromAlgebraic('h1')]).toBeNull();
    expect(state.castling.whiteKingside).toBe(false);
    expect(state.castling.whiteQueenside).toBe(false);
  });

  it('castles queenside for black and advances the fullmove number', () => {
    const state = craftedState(
      { e8: PIECES.black.king, a8: PIECES.black.rook },
      { turn: 'black', castling: { ...ALL_RIGHTS }, fullmoveNumber: 3 },
    );
    makeMove(state, mv('e8', 'c8', 'king', MoveFlags.CASTLE_QUEEN));

    expect(state.board[squareFromAlgebraic('c8')]).toBe(PIECES.black.king);
    expect(state.board[squareFromAlgebraic('d8')]).toBe(PIECES.black.rook);
    expect(state.board[squareFromAlgebraic('e8')]).toBeNull();
    expect(state.board[squareFromAlgebraic('a8')]).toBeNull();
    expect(state.fullmoveNumber).toBe(4);
    expect(state.turn).toBe('white');
  });
});

describe('castling rights', () => {
  it.each([
    ['a1', 'a2', 'whiteQueenside'],
    ['h1', 'h2', 'whiteKingside'],
  ] as const)('clears %s when the rook leaves it', (from, to, right) => {
    const state = craftedState(
      { [from]: PIECES.white.rook },
      { castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv(from, to, 'rook'));

    expect(state.castling[right]).toBe(false);
    expect(state.castling.blackKingside).toBe(true);
    expect(state.castling.blackQueenside).toBe(true);
  });

  it.each([
    ['a8', 'a7', 'blackQueenside'],
    ['h8', 'h7', 'blackKingside'],
  ] as const)('clears %s when the rook leaves it', (from, to, right) => {
    const state = craftedState(
      { [from]: PIECES.black.rook },
      { turn: 'black', castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv(from, to, 'rook'));

    expect(state.castling[right]).toBe(false);
    expect(state.castling.whiteKingside).toBe(true);
    expect(state.castling.whiteQueenside).toBe(true);
  });

  it.each([
    ['a2', 'a1', 'whiteQueenside'],
    ['h2', 'h1', 'whiteKingside'],
  ] as const)(
    'clears %s rights when its rook is captured',
    (from, to, right) => {
      const state = craftedState(
        { [from]: PIECES.black.rook, [to]: PIECES.white.rook },
        { turn: 'black', castling: { ...ALL_RIGHTS } },
      );
      makeMove(state, mv(from, to, 'rook', MoveFlags.CAPTURE));

      expect(state.castling[right]).toBe(false);
    },
  );

  it.each([
    ['a7', 'a8', 'blackQueenside'],
    ['h7', 'h8', 'blackKingside'],
  ] as const)(
    'clears %s rights when its rook is captured',
    (from, to, right) => {
      const state = craftedState(
        { [from]: PIECES.white.rook, [to]: PIECES.black.rook },
        { castling: { ...ALL_RIGHTS } },
      );
      makeMove(state, mv(from, to, 'rook', MoveFlags.CAPTURE));

      expect(state.castling[right]).toBe(false);
    },
  );

  it('clears both white rights when the white king moves', () => {
    const state = craftedState(
      { e1: PIECES.white.king },
      { castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv('e1', 'e2', 'king'));

    expect(state.castling.whiteKingside).toBe(false);
    expect(state.castling.whiteQueenside).toBe(false);
    expect(state.castling.blackKingside).toBe(true);
    expect(state.castling.blackQueenside).toBe(true);
  });

  it('clears both black rights when the black king moves', () => {
    const state = craftedState(
      { e8: PIECES.black.king },
      { turn: 'black', castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv('e8', 'e7', 'king'));

    expect(state.castling.blackKingside).toBe(false);
    expect(state.castling.blackQueenside).toBe(false);
    expect(state.castling.whiteKingside).toBe(true);
    expect(state.castling.whiteQueenside).toBe(true);
  });

  it('preserves all rights on an unrelated quiet move', () => {
    const state = initialState();
    makeMove(state, mv('g1', 'f3', 'knight'));

    expect(state.castling).toEqual(ALL_RIGHTS);
  });
});

describe('clocks', () => {
  it('increments the halfmove clock on quiet piece moves', () => {
    const state = initialState();
    makeMove(state, mv('g1', 'f3', 'knight'));
    makeMove(state, mv('g8', 'f6', 'knight'));

    expect(state.halfmoveClock).toBe(2);
    expect(state.fullmoveNumber).toBe(2);
    expect(state.turn).toBe('white');
  });
});

describe('unmakeMove', () => {
  it('throws when there is nothing to unmake', () => {
    expect(() => unmakeMove(initialState())).toThrow(/empty history/);
  });

  it('restores a captured piece', () => {
    const state = craftedState({
      e4: PIECES.white.pawn,
      d5: PIECES.black.knight,
    });
    makeMove(state, mv('e4', 'd5', 'pawn', MoveFlags.CAPTURE));
    unmakeMove(state);

    expect(state.board[squareFromAlgebraic('e4')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('d5')]).toBe(PIECES.black.knight);
    expect(state.turn).toBe('white');
  });

  it('restores an en-passant capture on the passed square', () => {
    const state = craftedState(
      { e5: PIECES.white.pawn, d5: PIECES.black.pawn },
      { enPassant: squareFromAlgebraic('d6') },
    );
    makeMove(
      state,
      mv('e5', 'd6', 'pawn', MoveFlags.CAPTURE | MoveFlags.EN_PASSANT),
    );
    unmakeMove(state);

    expect(state.board[squareFromAlgebraic('e5')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('d5')]).toBe(PIECES.black.pawn);
    expect(state.board[squareFromAlgebraic('d6')]).toBeNull();
    expect(state.enPassant).toBe(squareFromAlgebraic('d6'));
  });

  it('restores the pawn after a promotion', () => {
    const state = craftedState({ a7: PIECES.white.pawn });
    makeMove(state, mv('a7', 'a8', 'pawn', MoveFlags.PROMOTION, 'queen'));
    unmakeMove(state);

    expect(state.board[squareFromAlgebraic('a7')]).toBe(PIECES.white.pawn);
    expect(state.board[squareFromAlgebraic('a8')]).toBeNull();
  });

  it('un-castles kingside, restoring the rook and rights', () => {
    const state = craftedState(
      { e1: PIECES.white.king, h1: PIECES.white.rook },
      { castling: { ...ALL_RIGHTS } },
    );
    makeMove(state, mv('e1', 'g1', 'king', MoveFlags.CASTLE_KING));
    unmakeMove(state);

    expect(state.board[squareFromAlgebraic('e1')]).toBe(PIECES.white.king);
    expect(state.board[squareFromAlgebraic('h1')]).toBe(PIECES.white.rook);
    expect(state.board[squareFromAlgebraic('f1')]).toBeNull();
    expect(state.board[squareFromAlgebraic('g1')]).toBeNull();
    expect(state.castling).toEqual(ALL_RIGHTS);
  });

  it('un-castles queenside for black and rewinds the fullmove number', () => {
    const state = craftedState(
      { e8: PIECES.black.king, a8: PIECES.black.rook },
      { turn: 'black', castling: { ...ALL_RIGHTS }, fullmoveNumber: 3 },
    );
    makeMove(state, mv('e8', 'c8', 'king', MoveFlags.CASTLE_QUEEN));
    unmakeMove(state);

    expect(state.board[squareFromAlgebraic('e8')]).toBe(PIECES.black.king);
    expect(state.board[squareFromAlgebraic('a8')]).toBe(PIECES.black.rook);
    expect(state.board[squareFromAlgebraic('c8')]).toBeNull();
    expect(state.board[squareFromAlgebraic('d8')]).toBeNull();
    expect(state.fullmoveNumber).toBe(3);
    expect(state.turn).toBe('black');
  });
});

describe('make/unmake round-trip', () => {
  it('restores the exact prior state after a mixed sequence', () => {
    // Sparse middlegame exercising every mechanic: en passant, double
    // pushes, both castles, a promotion, and captures.
    const state = craftedState(
      {
        e1: PIECES.white.king,
        a1: PIECES.white.rook,
        h1: PIECES.white.rook,
        e5: PIECES.white.pawn,
        a2: PIECES.white.pawn,
        e8: PIECES.black.king,
        a8: PIECES.black.rook,
        h8: PIECES.black.rook,
        d5: PIECES.black.pawn,
        f7: PIECES.black.pawn,
      },
      {
        castling: { ...ALL_RIGHTS },
        enPassant: squareFromAlgebraic('d6'), // Black "just" played ...d7-d5.
        fullmoveNumber: 7,
      },
    );
    const snapshot = structuredClone(state);

    const sequence: Move[] = [
      mv('e5', 'd6', 'pawn', MoveFlags.CAPTURE | MoveFlags.EN_PASSANT),
      mv('f7', 'f5', 'pawn', MoveFlags.DOUBLE_PUSH),
      mv('e1', 'g1', 'king', MoveFlags.CASTLE_KING),
      mv('f5', 'f4', 'pawn'),
      mv('d6', 'd7', 'pawn'),
      mv('e8', 'c8', 'king', MoveFlags.CASTLE_QUEEN),
      mv('d7', 'd8', 'pawn', MoveFlags.CAPTURE | MoveFlags.PROMOTION, 'queen'),
      mv('c8', 'd8', 'king', MoveFlags.CAPTURE),
    ];

    for (const move of sequence) {
      makeMove(state, move);
    }
    expect(state.history).toHaveLength(sequence.length);

    const undone: Move[] = [];
    for (let i = 0; i < sequence.length; i++) {
      undone.push(unmakeMove(state));
    }

    expect(undone).toEqual([...sequence].reverse());
    expect(state).toEqual(snapshot);
  });
});
