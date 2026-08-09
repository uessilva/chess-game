import { BOARD_SIZE, isOnBoard } from './board';
import { makeMove, unmakeMove } from './move';
import { generatePseudoLegalMoves } from './movegen';
import type { BoardState } from './state';
import type { Color, Move, Piece, PieceType, Square } from './types';
import { opposite } from './types';

/**
 * Legality layer (task 1.6): king-safety filtering plus check, checkmate,
 * and stalemate detection, built on the pseudo-legal generator (task 1.5).
 *
 * Attack detection follows FIDE Laws article 3.1.3: a piece attacks a
 * square even when pinned. `isSquareAttacked` only asks whether a piece of
 * the given color attacks the square — it never asks whether moving that
 * piece would expose its own king. The king-safety filter in
 * `generateLegalMoves` is the only place pins matter.
 *
 * The 0x88 geometry mirrors movegen.ts: sliders walk each ray until the
 * first occupied square (the only candidate attacker along it), knights
 * use the 8 L-shaped steps, the king its 8 adjacent squares, and pawns
 * their two capture diagonals. Every offset walk is guarded by isOnBoard.
 */

const DIAGONAL_DIRECTIONS = [17, 15, -15, -17] as const;
const ORTHOGONAL_DIRECTIONS = [16, -16, 1, -1] as const;
const KNIGHT_STEPS = [33, 31, 18, 14, -14, -18, -31, -33] as const;
const KING_STEPS = [17, 16, 15, 1, -1, -15, -16, -17] as const;

/** Piece types that attack along a ray, by ray orientation. */
const DIAGONAL_ATTACKERS: readonly PieceType[] = ['bishop', 'queen'];
const ORTHOGONAL_ATTACKERS: readonly PieceType[] = ['rook', 'queen'];

/**
 * Offsets from the target square to a pawn of each color that attacks it.
 * White pawns attack one rank up, so a white attacker sits one rank below
 * and one file over the target; black pawns sit above it.
 */
const PAWN_ATTACKER_STEPS: Record<Color, readonly number[]> = {
  white: [-15, -17],
  black: [15, 17],
};

/**
 * Walk one ray outward from `sq`. The first piece encountered is the only
 * candidate attacker along that ray: it attacks `sq` iff it belongs to
 * `byColor` and its type matches the ray (bishop/queen on diagonals,
 * rook/queen on orthogonals). Pinned pieces attack normally — nothing here
 * checks whether the attacker's own king would be exposed.
 */
function rayAttacks(
  board: (Piece | null)[],
  sq: Square,
  byColor: Color,
  direction: number,
  types: readonly PieceType[],
): boolean {
  let to = sq + direction;
  while (isOnBoard(to)) {
    const piece = board[to];
    if (piece === null) {
      to += direction;
      continue;
    }
    return piece.color === byColor && types.includes(piece.type);
  }
  return false;
}

/**
 * Locate the king of `color`. Both kings are guaranteed present: parseFen
 * rejects any position with a different king count, so the throw below is
 * unreachable — it only satisfies the type checker.
 */
function kingSquare(state: BoardState, color: Color): Square {
  const { board } = state;
  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    const piece = board[sq];
    if (piece !== null && piece.type === 'king' && piece.color === color) {
      return sq;
    }
  }
  /* v8 ignore next -- parseFen guarantees exactly one king per side */
  throw new Error(`missing ${color} king`);
}

/**
 * True iff any piece of `byColor` attacks `sq`. Pseudo-attacks only
 * (FIDE 3.1.3): pinned pieces still attack.
 */
export function isSquareAttacked(
  state: BoardState,
  sq: Square,
  byColor: Color,
): boolean {
  const { board } = state;

  for (const direction of DIAGONAL_DIRECTIONS) {
    if (rayAttacks(board, sq, byColor, direction, DIAGONAL_ATTACKERS)) {
      return true;
    }
  }
  for (const direction of ORTHOGONAL_DIRECTIONS) {
    if (rayAttacks(board, sq, byColor, direction, ORTHOGONAL_ATTACKERS)) {
      return true;
    }
  }
  for (const step of KNIGHT_STEPS) {
    const to = sq + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const piece = board[to];
    if (piece !== null && piece.color === byColor && piece.type === 'knight') {
      return true;
    }
  }
  for (const step of KING_STEPS) {
    const to = sq + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const piece = board[to];
    if (piece !== null && piece.color === byColor && piece.type === 'king') {
      return true;
    }
  }
  for (const step of PAWN_ATTACKER_STEPS[byColor]) {
    const to = sq + step;
    if (!isOnBoard(to)) {
      continue;
    }
    const piece = board[to];
    if (piece !== null && piece.color === byColor && piece.type === 'pawn') {
      return true;
    }
  }
  return false;
}

/** True iff the king of `color` is attacked by the opposite color. */
export function isInCheck(state: BoardState, color: Color): boolean {
  return isSquareAttacked(state, kingSquare(state, color), opposite(color));
}

/**
 * The pseudo-legal moves for the side to move, minus any after which the
 * mover's king is in check. Correct-by-construction: try each move with
 * makeMove, test the mover's king, then unmakeMove. No pin pre-filtering
 * or check-evasion shortcuts — correctness before optimization.
 */
export function generateLegalMoves(state: BoardState): Move[] {
  const legal: Move[] = [];
  for (const move of generatePseudoLegalMoves(state)) {
    makeMove(state, move);
    // makeMove flips state.turn, so the mover is opposite(state.turn) now.
    if (!isInCheck(state, opposite(state.turn))) {
      legal.push(move);
    }
    unmakeMove(state);
  }
  return legal;
}

/** Side to move is in check and has no legal moves. */
export function isCheckmate(state: BoardState): boolean {
  return isInCheck(state, state.turn) && generateLegalMoves(state).length === 0;
}

/** Side to move is NOT in check and has no legal moves. */
export function isStalemate(state: BoardState): boolean {
  return (
    !isInCheck(state, state.turn) && generateLegalMoves(state).length === 0
  );
}
