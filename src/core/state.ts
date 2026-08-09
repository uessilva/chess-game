import { emptyBoard, square } from './board';
import { zobristHash } from './zobrist';
import type { Color, Move, Piece, PieceType, Square } from './types';
import { PIECES } from './types';

export interface CastlingRights {
  whiteKingside: boolean;
  whiteQueenside: boolean;
  blackKingside: boolean;
  blackQueenside: boolean;
}

/** Everything unmakeMove needs to restore the exact prior state. */
export interface UndoInfo {
  readonly move: Move;
  /** Piece removed from the board, or null for a non-capture. */
  readonly captured: Piece | null;
  readonly prevCastling: CastlingRights;
  readonly prevEnPassant: Square | null;
  readonly prevHalfmove: number;
}

/**
 * A full chess position plus the undo stack. Plain data — no methods, no
 * I/O — so states stay serializable (important when core is reused as the
 * RL environment later).
 */
export interface BoardState {
  /** 0x88 array; cells reference the shared PIECES singletons or null. */
  board: (Piece | null)[];
  turn: Color;
  castling: CastlingRights;
  /** Square a just-double-pushed pawn passed over, else null. */
  enPassant: Square | null;
  /** Halfmoves since the last pawn move or capture (fifty-move rule). */
  halfmoveClock: number;
  fullmoveNumber: number;
  history: UndoInfo[];
  /**
   * Zobrist hashes of every position reached, current position last.
   * Seeded with the starting position by parseFen/initialState; makeMove
   * pushes, unmakeMove pops. Position-irrelevant (not serialized by
   * toFen) — threefold repetition (#8) reads it.
   */
  positionHashes: bigint[];
}

const BACK_RANK: readonly PieceType[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

/**
 * The standard starting position. fen.test.ts cross-checks this against
 * parseFen(START_FEN), so the two stay in agreement.
 */
export function initialState(): BoardState {
  const board = emptyBoard();
  for (let file = 0; file < 8; file++) {
    board[square(file, 0)] = PIECES.white[BACK_RANK[file]];
    board[square(file, 1)] = PIECES.white.pawn;
    board[square(file, 6)] = PIECES.black.pawn;
    board[square(file, 7)] = PIECES.black[BACK_RANK[file]];
  }
  const state: BoardState = {
    board,
    turn: 'white',
    castling: {
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    positionHashes: [],
  };
  state.positionHashes.push(zobristHash(state));
  return state;
}
