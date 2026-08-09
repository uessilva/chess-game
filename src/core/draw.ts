import { BOARD_SIZE, fileOf, rankOf } from './board';
import type { BoardState } from './state';

export { zobristHash } from './zobrist';

/**
 * Draw-rule predicates (task 1.8): fifty-move rule, threefold repetition
 * (via Zobrist hashing and the position history), and insufficient
 * material. All pure functions over BoardState — the UI/engine decide
 * whether to auto-end the game or offer a claim (game-flow, #13/#17).
 */

/** 50 full moves by each player without a pawn move or capture (FIDE 9.3). */
export const FIFTY_MOVE_LIMIT = 100;

/**
 * True iff the halfmove clock has reached the fifty-move threshold — 100
 * halfmoves since the last pawn move or capture. makeMove already resets
 * the clock on pawn moves/captures and increments it otherwise; this
 * predicate interprets it. FIDE 9.6.2's automatic 75-move rule (150
 * halfmoves) is deliberately out of scope.
 */
export function isFiftyMoveDraw(state: BoardState): boolean {
  return state.halfmoveClock >= FIFTY_MOVE_LIMIT;
}

/**
 * True iff the current position's hash occurs at least three times in the
 * position history, including the current occurrence (FIDE article 9.2).
 * The history is seeded with the starting position by parseFen/initialState
 * and maintained by makeMove (push) / unmakeMove (pop), so the last entry
 * is always the current position.
 */
export function isThreefoldRepetition(state: BoardState): boolean {
  const hashes = state.positionHashes;
  if (hashes.length === 0) {
    return false;
  }
  const current = hashes[hashes.length - 1];
  let count = 0;
  for (const hash of hashes) {
    if (hash === current) {
      count++;
    }
  }
  return count >= 3;
}

/**
 * True for the classical dead positions where no sequence of legal moves
 * can lead to checkmate (FIDE articles 5.2.2 / 9.6.1): with only knights
 * and bishops on the board, dead iff there is at most one minor total, or
 * exactly two bishops — one per side — on the same square color. Any pawn,
 * rook, or queen makes the position live (mate is theoretically possible);
 * KNN v K is live (a mate exists, though not forceable).
 */
export function isInsufficientMaterial(state: BoardState): boolean {
  let whiteMinors = 0;
  let blackMinors = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  const bishopColors = new Set<number>();

  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    const piece = state.board[sq];
    if (piece === null) {
      continue;
    }
    if (piece.type === 'king') {
      continue;
    }
    if (
      piece.type === 'pawn' ||
      piece.type === 'rook' ||
      piece.type === 'queen'
    ) {
      return false;
    }
    if (piece.color === 'white') {
      whiteMinors++;
      if (piece.type === 'bishop') {
        whiteBishops++;
        bishopColors.add((fileOf(sq) + rankOf(sq)) % 2);
      }
    } else {
      blackMinors++;
      if (piece.type === 'bishop') {
        blackBishops++;
        bishopColors.add((fileOf(sq) + rankOf(sq)) % 2);
      }
    }
  }

  const totalMinors = whiteMinors + blackMinors;
  if (totalMinors <= 1) {
    return true;
  }
  if (totalMinors === 2 && whiteBishops === 1 && blackBishops === 1) {
    return bishopColors.size === 1;
  }
  return false;
}
