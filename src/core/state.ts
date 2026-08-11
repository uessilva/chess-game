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
  /** The pre-move zobrist key, restored exactly by unmakeMove. */
  readonly prevZobristKey: bigint;
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
   * The 64-bit Zobrist hash of the current position — always equal to
   * `zobristHash(state)` (enforced by tests after every move). makeMove
   * maintains it incrementally in O(1) and unmakeMove restores the exact
   * previous key, so the engine can key every search node without
   * rescanning the board (transposition table, task 3.5). Not serialized
   * by toFen — position identity is derived from the FEN fields.
   */
  zobristKey: bigint;
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
    zobristKey: 0n,
  };
  state.zobristKey = zobristHash(state);
  state.positionHashes.push(state.zobristKey);
  return state;
}
