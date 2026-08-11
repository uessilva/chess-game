import { fileOf, rankOf } from '../core/board';
import type { BoardState } from '../core/state';
import type { PieceType, Square } from '../core/types';

/**
 * Static leaf evaluation (task 3.1): material balance plus piece-square
 * tables (PST), scored from the side-to-move's perspective. This is the
 * leaf function the negamax search (#17) will call millions of times, so
 * the API is one pure function with no hidden state.
 *
 * Convention (documented here because the decomposed functions are
 * exported for testability): `materialScore` and `pieceSquareScore` are
 * both from White's perspective (white pieces add, black pieces subtract);
 * `evaluate` returns their sum when White is to move and its negation when
 * Black is to move, which is the negamax convention — the search maximises
 * without colour special-casing. So `evaluate(state)` equals
 * `materialScore(state) + pieceSquareScore(state)` for any White-to-move
 * state.
 *
 * Deliberately out of scope for 3.1 (see the issue): castling-rights /
 * mobility / king-safety scoring, the endgame king table (#21), terminal
 * positions, and incremental evaluation — this task scores by scanning the
 * board, correctness first per AGENTS.md.
 */

/** Material values in centipawns (standard simplified values, king 0). */
const MATERIAL_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 0,
};

/**
 * Piece-square tables copied verbatim from the chessprogrammingwiki
 * "Simplified Evaluation Function" article (Tomasz Michniewski). The
 * printed order is rank 8 → rank 1, file a → h, so row 0 is rank 8 and
 * row 7 is rank 1 (White's back rank); a 0x88 square maps to the table
 * index `(7 - rankOf(sq)) * 8 + fileOf(sq)`. Black pieces are scored on
 * the rank-mirrored tables (`sq ^ 0x70`, the 0x88 rank 0 ↔ 7 reflection)
 * — that mirror symmetry is what makes the initial position score 0.
 */
export const PIECE_SQUARE_TABLES: Record<PieceType, readonly number[]> = {
  pawn: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30,
    20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5,
    -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0,
    0,
  ],
  knight: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30,
    0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20,
    20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20,
    -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  bishop: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0,
    5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10,
    0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20,
    -10, -10, -10, -10, -10, -10, -20,
  ],
  rook: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0,
    -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0,
    0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  queen: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5,
    5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5,
    5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10,
    -10, -20,
  ],
  king: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
    -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40,
    -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20,
    -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

/** Map a 0x88 square to its index in a CPW-ordered (rank 8 first) table. */
function tableIndex(sq: Square): number {
  return (7 - rankOf(sq)) * 8 + fileOf(sq);
}

/**
 * Material balance from White's perspective: white pieces add their
 * centipawn value, black pieces subtract it.
 */
export function materialScore(state: BoardState): number {
  let score = 0;
  for (let sq = 0; sq < state.board.length; sq++) {
    const piece = state.board[sq];
    if (piece === null) {
      continue;
    }
    const value = MATERIAL_VALUES[piece.type];
    score += piece.color === 'white' ? value : -value;
  }
  return score;
}

/**
 * Piece-square score from White's perspective. White pieces are scored on
 * the printed tables; black pieces are scored on the rank-mirrored tables
 * (`sq ^ 0x70`).
 */
export function pieceSquareScore(state: BoardState): number {
  let score = 0;
  for (let sq = 0; sq < state.board.length; sq++) {
    const piece = state.board[sq];
    if (piece === null) {
      continue;
    }
    const table = PIECE_SQUARE_TABLES[piece.type];
    const index =
      piece.color === 'white' ? tableIndex(sq) : tableIndex(sq ^ 0x70);
    score += piece.color === 'white' ? table[index] : -table[index];
  }
  return score;
}

/**
 * Static leaf evaluation from the side-to-move's perspective: positive
 * means the side to move is better. Equal material and mirror-symmetric
 * piece placement score 0.
 */
export function evaluate(state: BoardState): number {
  const whiteScore = materialScore(state) + pieceSquareScore(state);
  return state.turn === 'white' ? whiteScore : -whiteScore;
}
