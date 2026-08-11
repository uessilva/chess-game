import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { evaluate as defaultEvaluate } from './eval';

/**
 * Fixed-depth negamax search with alpha-beta pruning (task 3.2).
 *
 * Pure module: depends on `src/core` only (no DOM, no I/O), so it runs
 * unchanged in the Web Worker, in the browser, and in Node tests. It
 * consumes core exactly as exported — `generateLegalMoves`, `makeMove` /
 * `unmakeMove`, `isInCheck` — so every searched move is perft-verified
 * legal and every recursion restores the state.
 *
 * Scoring convention (from the #16 spec, negamax contract): `evaluate`
 * returns the score from the side to move's perspective, so the search
 * maximises by negating at each ply with no colour special-casing. Leaf
 * nodes return `evaluate(state)`. Terminal nodes inside the tree: the side
 * to move has no legal moves and is in check → `-(MATE_SCORE - ply)`
 * (distance-adjusted, so the engine prefers the fastest mate: a mate-in-1
 * roots at `MATE_SCORE - 1`, a mate-in-2 at `MATE_SCORE - 3`); no legal
 * moves and not in check (stalemate) → `0`. Draw-by-rule handling
 * (threefold, fifty-move, insufficient material) is deliberately out of
 * scope here — the UI guards dispatch with `deriveGameStatus`.
 *
 * NOTE: the acceptance criteria pin the distance adjustment as
 * `MATE_SCORE - ply` (fastest mate wins); the search-spec draft formula
 * `-(MATE_SCORE + ply)` would score a slower mate higher, so this file
 * follows the criteria.
 *
 * Alpha-beta is standard and move-order-blind on purpose: moves are tried
 * in plain `generateLegalMoves` order (move ordering is task 3.3 —
 * correctness before optimization). The window (alpha, beta) only ever
 * cuts branches that cannot beat the current best, so the root move and
 * score are identical to an unpruned negamax — verified by the reference
 * comparison in search.test.ts. Determinism: same position and depth
 * always yield the same move (ties resolve to the first move with the
 * maximum score in generation order).
 */

/**
 * The score of a checkmate. Far above any material/PST total (centipawns),
 * so a mating line always outranks a merely winning one. Root mate scores
 * are `MATE_SCORE + ply`, which is why the value itself must be large
 * enough to dwarf any static evaluation sum.
 */
export const MATE_SCORE = 1_000_000;

/** The leaf scoring function: a side-to-move-relative score. */
export type Evaluator = (state: BoardState) => number;

/** What a full root search returns: the best move and its score. */
export interface SearchResult {
  readonly move: Move | null;
  readonly score: number;
}

/**
 * Depth validation, perft-harness style: a negative or non-integer depth
 * is a caller bug, not a zero-search result.
 */
function assertValidDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(
      `searchBestMove: depth must be a non-negative integer, got ${depth}`,
    );
  }
}

/**
 * Negamax over `generateLegalMoves(state)`, recursing with makeMove /
 * unmakeMove. Returns the best score from the side to move's perspective.
 * Terminal nodes are scored before the depth check so a checkmate is
 * always a mate score, never a static evaluation.
 */
function negamax(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  evaluate: Evaluator,
): number {
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return isInCheck(state, state.turn) ? -(MATE_SCORE - ply) : 0;
  }
  if (depth === 0) {
    return evaluate(state);
  }
  let best = -Infinity;
  for (const move of moves) {
    makeMove(state, move);
    const score = -negamax(state, depth - 1, -beta, -alpha, ply + 1, evaluate);
    unmakeMove(state);
    if (score > best) {
      best = score;
    }
    if (best > alpha) {
      alpha = best;
    }
    if (alpha >= beta) {
      break;
    }
  }
  return best;
}

/**
 * Fixed-depth root search: the best move for the side to move plus its
 * negamax score. Root moves are each searched exactly (infinite window),
 * so the returned score is the exact minimax value — the score the worker
 * reports back to the UI.
 *
 * - No legal moves: the game is over. `move` is null; the score is
 *   `-MATE_SCORE` when the side to move is checkmated and `0` when it is
 *   stalemated.
 * - Depth 0 (perft-harness-style validation): no plies to search, so no
 *   move is chosen — `move` is null and the score is the static
 *   evaluation.
 */
export function search(
  state: BoardState,
  depth: number,
  evaluate: Evaluator = defaultEvaluate,
): SearchResult {
  assertValidDepth(depth);
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return {
      move: null,
      score: isInCheck(state, state.turn) ? -MATE_SCORE : 0,
    };
  }
  if (depth === 0) {
    return { move: null, score: evaluate(state) };
  }
  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    makeMove(state, move);
    const score = -negamax(state, depth - 1, -Infinity, Infinity, 1, evaluate);
    unmakeMove(state);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return { move: bestMove, score: bestScore };
}

/**
 * The caller-facing search contract: the best legal move for the side to
 * move at the given depth, or null when the side to move has no legal
 * moves (checkmate or stalemate). `evaluate` defaults to #16's exported
 * evaluation and can be injected so unit tests use a deterministic stub.
 */
export function searchBestMove(
  state: BoardState,
  depth: number,
  evaluate?: Evaluator,
): Move | null {
  return search(state, depth, evaluate).move;
}
