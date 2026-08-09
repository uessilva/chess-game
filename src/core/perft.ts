import { algebraicOf } from './board';
import { parseFen } from './fen';
import { generateLegalMoves } from './legality';
import { makeMove, unmakeMove } from './move';
import type { BoardState } from './state';
import type { Move, PieceType } from './types';

/**
 * Perft harness (task 1.9) — the project's correctness oracle.
 *
 * Perft ("performance test", per the chessprogramming wiki) counts the
 * leaf nodes of the move tree to a given depth from a position. The
 * counts are move-order-independent and published for a standard set of
 * positions, so they verify the move generator exactly: any deviation
 * means `generateLegalMoves` or make/unmake is wrong.
 *
 * The harness runs over LEGAL moves (king-safety filtered): pins, castling
 * out of/through check, and the pinned en-passant capture are all
 * exercised. It mutates a passed BoardState only transiently — every move
 * is followed by unmakeMove, so the state is identical when the call
 * returns. A FEN string is parsed once with parseFen, so a malformed FEN
 * throws the same descriptive "invalid FEN:" error it would anywhere
 * else — never a silent wrong count.
 *
 * `perft` returns the total leaf count; `divide` breaks that total down
 * per root move — the debugging tool for a mismatch, since the sum of its
 * values equals `perft` at the same depth (for depth >= 1).
 */

/** Promotion piece → the character appended to a divide key. */
const PROMOTION_CHARS: Record<PieceType, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** A FEN string is parsed once; a BoardState is used as-is. */
function resolveState(position: string | BoardState): BoardState {
  return typeof position === 'string' ? parseFen(position) : position;
}

/** A negative or fractional depth is a caller bug, not a zero-leaf result. */
function assertValidDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(
      `perft: depth must be a non-negative integer, got ${depth}`,
    );
  }
}

/**
 * The divide key for a move: algebraic `from->to`, suffixed with the
 * promotion piece (e.g. `a7->a8=q`) so the four promotion variants of a
 * pawn push stay distinct entries instead of colliding on one key.
 */
function moveKey(move: Move): string {
  const key = `${algebraicOf(move.from)}->${algebraicOf(move.to)}`;
  return move.promotion === undefined
    ? key
    : `${key}=${PROMOTION_CHARS[move.promotion]}`;
}

/** Recursive leaf counter over legal moves; make/unmake restores the state. */
function countNodes(state: BoardState, depth: number): number {
  if (depth === 0) {
    return 1;
  }
  let nodes = 0;
  for (const move of generateLegalMoves(state)) {
    makeMove(state, move);
    nodes += countNodes(state, depth - 1);
    unmakeMove(state);
  }
  return nodes;
}

/**
 * Total leaf-node count from `position` to the given depth. `position`
 * accepts a FEN string or a BoardState; a malformed FEN throws the
 * descriptive parseFen error.
 */
export function perft(position: string | BoardState, depth: number): number {
  assertValidDepth(depth);
  return countNodes(resolveState(position), depth);
}

/**
 * Per-move leaf-node counts from `position` to the given depth, keyed by
 * algebraic `from->to` (promotion variants suffixed, e.g. `a7->a8=q`).
 * At depth 0 there are no root moves, so an empty map is returned.
 */
export function divide(
  position: string | BoardState,
  depth: number,
): Map<string, number> {
  assertValidDepth(depth);
  const state = resolveState(position);
  const counts = new Map<string, number>();
  if (depth === 0) {
    return counts;
  }
  for (const move of generateLegalMoves(state)) {
    makeMove(state, move);
    counts.set(moveKey(move), countNodes(state, depth - 1));
    unmakeMove(state);
  }
  return counts;
}
