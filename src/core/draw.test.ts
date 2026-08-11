import { describe, expect, it } from 'vitest';

import { emptyBoard, squareFromAlgebraic } from './board';
import {
  FIFTY_MOVE_LIMIT,
  isFiftyMoveDraw,
  isInsufficientMaterial,
  isThreefoldRepetition,
  perft,
  zobristHash,
} from './index';
import { parseFen, START_FEN, toFen } from './fen';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import { initialState } from './state';
import type { Move, Piece, PieceType } from './types';
import { MoveFlags, PIECES } from './types';

const KIWIPETE_FEN =
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Build a sparse position directly from square → piece entries. */
function craftedState(
  pieces: Record<string, Piece>,
  overrides: Partial<BoardState> = {},
): BoardState {
  const state: BoardState = {
    board: emptyBoard(),
    turn: 'white',
    castling: {
      whiteKingside: false,
      whiteQueenside: false,
      blackKingside: false,
      blackQueenside: false,
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    positionHashes: [],
    zobristKey: 0n,
    ...overrides,
  };
  for (const [alg, piece] of Object.entries(pieces)) {
    state.board[squareFromAlgebraic(alg)] = piece;
  }
  state.zobristKey = zobristHash(state);
  return state;
}

function mv(from: string, to: string, piece: PieceType, flags = 0): Move {
  return {
    from: squareFromAlgebraic(from),
    to: squareFromAlgebraic(to),
    piece,
    flags,
  };
}

describe('isFiftyMoveDraw', () => {
  it('is false at 99 halfmoves and true at 100 after a quiet king move', () => {
    // FIDE 9.3: 50 full moves by each player without a pawn move or capture.
    const state = parseFen('4k3/8/8/8/8/8/8/4K3 w - - 99 75');
    expect(isFiftyMoveDraw(state)).toBe(false);
    makeMove(state, mv('e1', 'e2', 'king'));
    expect(state.halfmoveClock).toBe(100);
    expect(isFiftyMoveDraw(state)).toBe(true);
  });

  it('exposes the threshold as a named constant', () => {
    expect(FIFTY_MOVE_LIMIT).toBe(100);
  });

  it('is true immediately after parsing a FEN with a clock of 100, and the clock round-trips', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 100 75';
    const state = parseFen(fen);
    expect(isFiftyMoveDraw(state)).toBe(true);
    expect(toFen(state)).toBe(fen);
  });

  it('resets to false when a pawn move clears the clock', () => {
    const state = parseFen('4k3/8/8/8/8/8/P7/4K3 w - - 50 26');
    makeMove(state, mv('a2', 'a3', 'pawn'));
    expect(state.halfmoveClock).toBe(0);
    expect(isFiftyMoveDraw(state)).toBe(false);
  });

  it('resets to false when a capture clears the clock at 99', () => {
    // The draw window restarts even from the threshold's doorstep.
    const state = parseFen('4k3/8/8/8/8/8/4r3/4K3 w - - 99 75');
    makeMove(state, mv('e1', 'e2', 'king', MoveFlags.CAPTURE));
    expect(state.halfmoveClock).toBe(0);
    expect(isFiftyMoveDraw(state)).toBe(false);
  });
});

describe('zobristHash', () => {
  it('hashes two identical states identically', () => {
    expect(zobristHash(parseFen(KIWIPETE_FEN))).toBe(
      zobristHash(parseFen(KIWIPETE_FEN)),
    );
  });

  it('differs when the piece placement differs', () => {
    const start = parseFen(START_FEN);
    const afterE4 = parseFen(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(zobristHash(start)).not.toBe(zobristHash(afterE4));
  });

  it('differs when the side to move differs', () => {
    const whiteToMove = parseFen('k7/8/8/8/8/8/8/K7 w - - 0 1');
    const blackToMove = parseFen('k7/8/8/8/8/8/8/K7 b - - 0 1');
    expect(zobristHash(whiteToMove)).not.toBe(zobristHash(blackToMove));
  });

  it('differs when castling rights differ', () => {
    const withRights = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const withoutRights = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(zobristHash(withRights)).not.toBe(zobristHash(withoutRights));
  });

  it('ignores a meaningless en-passant target (no capturer available)', () => {
    // After 1.e4 the e3 window exists but no black pawn can capture.
    const withEp = parseFen(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    const withoutEp = parseFen(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );
    expect(zobristHash(withEp)).toBe(zobristHash(withoutEp));
  });

  it('includes a meaningful en-passant target (capturer available)', () => {
    // White pawn e5 can capture the d6 window en passant.
    const withEp = parseFen('7k/8/8/3pP3/8/8/8/K7 w - d6 0 1');
    const withoutEp = parseFen('7k/8/8/3pP3/8/8/8/K7 w - - 0 1');
    expect(zobristHash(withEp)).not.toBe(zobristHash(withoutEp));
  });

  it('ignores an en-passant target on an impossible rank', () => {
    // White to move; rank 4 is never a white target rank, so e4 is moot.
    const withEp = craftedState(
      { e5: PIECES.white.pawn, a8: PIECES.black.king, e1: PIECES.white.king },
      { enPassant: squareFromAlgebraic('e4') },
    );
    const withoutEp = craftedState(
      { e5: PIECES.white.pawn, a8: PIECES.black.king, e1: PIECES.white.king },
      { enPassant: null },
    );
    expect(zobristHash(withEp)).toBe(zobristHash(withoutEp));
  });

  it('treats an en-passant target on the a-file like any other file', () => {
    // White pawn b5 captures a6 en passant; the file-1 candidate is
    // off-board, exercising the isOnBoard guard in the availability check.
    const withEp = parseFen('k7/8/8/pP6/8/8/8/7K w - a6 0 1');
    const withoutEp = parseFen('k7/8/8/pP6/8/8/8/7K w - - 0 1');
    expect(zobristHash(withEp)).not.toBe(zobristHash(withoutEp));
  });
});

describe('castling rights are permanent (FIDE 9.2.2)', () => {
  it('a rook returning home does not restore a lost right, so the hash changes', () => {
    const start = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const initialHash = zobristHash(start);

    // White lifts the h1 rook (revoking kingside), black shuffles its a8
    // rook away, both return home. Placement matches the start...
    makeMove(start, mv('h1', 'h2', 'rook'));
    makeMove(start, mv('a8', 'a7', 'rook'));
    makeMove(start, mv('h2', 'h1', 'rook'));
    makeMove(start, mv('a7', 'a8', 'rook'));
    expect(toFen(start).split(' ')[0]).toBe('r3k2r/8/8/8/8/8/8/R3K2R');

    // ...but the permanently lost rights mean the position is not identical,
    // so the shuffle never reports a repetition.
    expect(zobristHash(start)).not.toBe(initialHash);
    expect(isThreefoldRepetition(start)).toBe(false);
  });
});

describe('position history', () => {
  it('seeds the history with the starting position from initialState and parseFen', () => {
    const initial = initialState();
    expect(initial.positionHashes).toEqual([zobristHash(initial)]);
    const parsed = parseFen(START_FEN);
    expect(parsed.positionHashes).toEqual([zobristHash(parsed)]);
    expect(parsed).toEqual(initial);
  });

  it('pushes a hash on makeMove and pops it back on unmakeMove', () => {
    const state = parseFen(START_FEN);
    const startHash = state.positionHashes[0];
    makeMove(state, mv('e2', 'e4', 'pawn', MoveFlags.DOUBLE_PUSH));
    expect(state.positionHashes).toHaveLength(2);
    expect(state.positionHashes[1]).toBe(zobristHash(state));
    expect(state.positionHashes[1]).not.toBe(startHash);
    unmakeMove(state);
    expect(state.positionHashes).toEqual([startHash]);
  });

  it('round-trips the exact history through a make/unmake cycle', () => {
    const state = parseFen(START_FEN);
    const snapshot = structuredClone(state);
    makeMove(state, mv('g1', 'f3', 'knight'));
    makeMove(state, mv('g8', 'f6', 'knight'));
    unmakeMove(state);
    unmakeMove(state);
    expect(state).toEqual(snapshot);
    expect(state.positionHashes).toEqual(snapshot.positionHashes);
  });

  it('does not leak into toFen (round-trip still holds after moves)', () => {
    const state = parseFen(START_FEN);
    makeMove(state, mv('e2', 'e4', 'pawn', MoveFlags.DOUBLE_PUSH));
    expect(state.positionHashes).toHaveLength(2);
    expect(toFen(state)).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    expect(toFen(parseFen(toFen(state)))).toBe(toFen(state));
  });
});

describe('isThreefoldRepetition', () => {
  it('is false at the second occurrence and true at the third (king shuffle)', () => {
    const state = parseFen('k7/8/8/8/8/8/8/K7 w - - 0 1');
    const shuffle = [
      mv('a1', 'b1', 'king'),
      mv('a8', 'b8', 'king'),
      mv('b1', 'a1', 'king'),
      mv('b8', 'a8', 'king'),
    ];
    // Two full moves: back to the start position (occurrence 2).
    for (const move of shuffle) {
      makeMove(state, move);
    }
    expect(isThreefoldRepetition(state)).toBe(false);
    // Two more full moves: occurrence 3.
    for (const move of shuffle) {
      makeMove(state, move);
    }
    expect(isThreefoldRepetition(state)).toBe(true);
  });

  it('does not count a position with the other side to move as the same position', () => {
    const state = parseFen('k7/8/8/8/8/8/8/K7 w - - 0 1');
    // Reaching the black-to-move lookalikes never adds to the count of the
    // white-to-move start position.
    for (const move of [
      mv('a1', 'b1', 'king'),
      mv('a8', 'b8', 'king'),
      mv('b1', 'a1', 'king'),
      mv('b8', 'a8', 'king'),
      mv('a1', 'b1', 'king'),
      mv('a8', 'b8', 'king'),
    ]) {
      makeMove(state, move);
    }
    expect(isThreefoldRepetition(state)).toBe(false);
  });

  it('is false when no position history is recorded (crafted state)', () => {
    const state = craftedState({
      a8: PIECES.black.king,
      e1: PIECES.white.king,
    });
    expect(isThreefoldRepetition(state)).toBe(false);
  });
});

describe('isInsufficientMaterial', () => {
  it('is true for lone kings and single-minor endings', () => {
    const cases = [
      '4k3/8/8/8/8/8/8/4K3 w - - 0 1', // K v K
      '4k3/8/8/8/8/8/8/2N1K3 w - - 0 1', // K+N v K
      '4k3/8/8/8/8/8/2B5/4K3 w - - 0 1', // K+B v K
      '4k3/8/8/8/8/8/2n5/4K3 w - - 0 1', // K v K+N (black knight)
    ];
    for (const fen of cases) {
      expect(isInsufficientMaterial(parseFen(fen))).toBe(true);
    }
  });

  it('is true for same-colored bishops (mate impossible)', () => {
    // White bishop c2 and black bishop a8 both sit on light squares.
    const state = parseFen('b6k/8/8/8/8/8/2B5/4K3 w - - 0 1');
    expect(isInsufficientMaterial(state)).toBe(true);
  });

  it('is false for opposite-colored bishops (mate is theoretically possible)', () => {
    // White bishop c2 (light) and black bishop b8 (dark).
    const state = parseFen('1b5k/8/8/8/8/8/2B5/4K3 w - - 0 1');
    expect(isInsufficientMaterial(state)).toBe(false);
  });

  it('is false for material that can still mate', () => {
    const cases = [
      '7k/8/8/8/8/8/8/2Q1K3 w - - 0 1', // K+Q v K
      '7k/8/8/8/8/8/8/2R1K3 w - - 0 1', // K+R v K
      'k7/8/8/8/8/8/8/1NN1K3 w - - 0 1', // K+2N v K
      'k7/8/8/8/8/8/2N5/4KB2 w - - 0 1', // K+B v K+N
      '4k3/8/8/8/8/8/P7/4K3 w - - 0 1', // any pawn present
    ];
    for (const fen of cases) {
      expect(isInsufficientMaterial(parseFen(fen))).toBe(false);
    }
  });

  it('is false for three minors (mate remains theoretically possible)', () => {
    const state = parseFen('k7/8/8/8/8/2B2N2/3N4/4K3 w - - 0 1');
    expect(isInsufficientMaterial(state)).toBe(false);
  });
});

describe('perft regression (draw bookkeeping does not disturb movegen)', () => {
  it('startpos depth 4 = 197281', () => {
    expect(perft(parseFen(START_FEN), 4)).toBe(197281);
  }, 30_000);

  it('Kiwipete depth 3 = 97862', () => {
    expect(perft(parseFen(KIWIPETE_FEN), 3)).toBe(97862);
  }, 30_000);
});
