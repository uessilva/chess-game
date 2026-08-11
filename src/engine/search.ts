import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { MoveFlags } from '../core/types';
import { evaluate as defaultEvaluate } from './eval';
import { MoveOrdering } from './moveOrdering';

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
 * Alpha-beta is standard and move-order-blind: moves at each node are
 * reordered by task 3.3's ordering (MVV-LVA captures, killers, history)
 * purely to raise the cutoff rate — ordering is a permutation, so the
 * window (alpha, beta) only ever cuts branches that cannot beat the
 * current best, and the root move and score are identical to an
 * unpruned negamax — verified by the reference comparison in
 * search.test.ts. Determinism: same position and depth always yield the
 * same move (ties resolve to the first move with the maximum score in
 * generation order — the root is never reordered, since an infinite
 * window makes its order irrelevant to nodes and scores). The one
 * exception is task 3.4's iterative-deepening PV move, which is moved
 * to the front of the root; that is still a pure permutation, so a
 * fixed-depth call without a `pvMove` behaves exactly as before.
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

/**
 * Search knobs. `ordered` toggles task 3.3's move ordering: `true`
 * (default) reorders each node's move list with MVV-LVA captures,
 * killers, and the history heuristic; `false` searches the natural
 * `generateLegalMoves` order — the comparison baseline for the
 * node-reduction acceptance gate. Either way the best move and score are
 * identical, because ordering is a pure permutation and alpha-beta is
 * move-order-blind.
 *
 * `pvMove` and `shouldAbort` exist for task 3.4's iterative-deepening
 * wrapper. `pvMove` is the previous iteration's best move, searched first
 * at the root (a pure permutation — the infinite root window makes it
 * tie-breaking-neutral only when scores differ, and node counts never
 * change, so plain fixed-depth callers are unaffected). `shouldAbort` is
 * the cooperative deadline: when it returns true inside a node the search
 * throws `SearchTimeoutError`, abandoning the in-flight iteration so the
 * wrapper can fall back to the last fully completed one.
 */
export interface SearchOptions {
  readonly ordered?: boolean;
  /** Root move to search first (the previous ID iteration's PV move). */
  readonly pvMove?: Move | null;
  /** Cooperative deadline check; when true, the search throws SearchTimeoutError. */
  readonly shouldAbort?: () => boolean;
}

/**
 * Thrown by `search` when `shouldAbort()` turns true mid-iteration: the
 * depth-budgeted search of an iterative-deepening iteration was abandoned
 * before completion. `nodes` carries how many nodes that partial iteration
 * had already visited, so the wrapper can still account for the work done.
 */
export class SearchTimeoutError extends Error {
  readonly nodes: number;

  constructor(nodes: number) {
    super('search aborted: time budget exceeded');
    this.name = 'SearchTimeoutError';
    this.nodes = nodes;
  }
}

/** What a full root search returns: the best move and its score. */
export interface SearchResult {
  readonly move: Move | null;
  readonly score: number;
  /**
   * Nodes visited by the search: the root position plus every negamax
   * call (task 3.3's node counter). Strictly lower with ordering enabled
   * at a fixed depth — the acceptance gate's measured quantity.
   */
  readonly nodes: number;
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
 * True for a quiet move: not a capture (en passant carries CAPTURE) and
 * not a promotion. Only quiet moves are recorded as killers / history —
 * captures already rank above quiets via MVV-LVA.
 */
function isQuiet(move: Move): boolean {
  return (move.flags & (MoveFlags.CAPTURE | MoveFlags.PROMOTION)) === 0;
}

/**
 * Move identity: from/to plus the promotion piece. `generateLegalMoves`
 * allocates fresh Move objects per call, so the previous iteration's PV
 * move (a different object) must be matched structurally, never by
 * reference.
 */
function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

/**
 * Negamax over `generateLegalMoves(state)`, recursing with makeMove /
 * unmakeMove. Returns the best score from the side to move's perspective.
 * Terminal nodes are scored before the depth check so a checkmate is
 * always a mate score, never a static evaluation. When `ordered` is set,
 * each node's moves are reordered first (MVV-LVA, killers, history) and a
 * quiet move that cuts beta is recorded as a killer and a history bonus —
 * this never changes the minimax result, only how early cutoffs happen.
 */
function negamax(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  evaluate: Evaluator,
  ordered: boolean,
  ordering: MoveOrdering,
  shouldAbort: (() => boolean) | undefined,
): number {
  ordering.nodes++;
  // Cooperative deadline: the iterative-deepening wrapper abandons an
  // in-flight iteration by throwing; the node was visited, so it is
  // counted before the throw. Depth 1 is exempt by design — the wrapper
  // never passes shouldAbort for it (the floor guarantee).
  if (shouldAbort !== undefined && shouldAbort()) {
    throw new SearchTimeoutError(ordering.nodes);
  }
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return isInCheck(state, state.turn) ? -(MATE_SCORE - ply) : 0;
  }
  if (depth === 0) {
    return evaluate(state);
  }
  const searched = ordered ? ordering.orderMoves(state, moves, ply) : moves;
  let best = -Infinity;
  for (const move of searched) {
    makeMove(state, move);
    const score = -negamax(
      state,
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
      evaluate,
      ordered,
      ordering,
      shouldAbort,
    );
    unmakeMove(state);
    if (score > best) {
      best = score;
    }
    if (best > alpha) {
      alpha = best;
    }
    if (alpha >= beta) {
      if (ordered && isQuiet(move)) {
        ordering.recordKiller(move, ply);
        ordering.recordHistory(move, depth);
      }
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
  options: SearchOptions = {},
): SearchResult {
  assertValidDepth(depth);
  const ordered = options.ordered ?? true;
  const shouldAbort = options.shouldAbort;
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return {
      move: null,
      score: isInCheck(state, state.turn) ? -MATE_SCORE : 0,
      nodes: 1,
    };
  }
  if (depth === 0) {
    return { move: null, score: evaluate(state), nodes: 1 };
  }
  const ordering = new MoveOrdering(depth);
  ordering.nodes = 1; // the root position
  // The root is searched with an infinite window, so its move order
  // cannot affect node counts or scores — ordering would only re-break
  // score ties. Keep the natural `generateLegalMoves` order here: ties
  // resolve to the first move with the maximum score in generation
  // order, exactly as an unordered search. Ordering applies at ply >= 1.
  // The sole exception is the iterative-deepening PV move: it is moved
  // to the front (still a permutation) so each ID iteration re-confirms
  // the previous iteration's best first.
  let rootMoves = moves;
  const pvMove = options.pvMove ?? null;
  if (pvMove !== null) {
    const index = moves.findIndex((move) => sameMove(move, pvMove));
    if (index > 0) {
      rootMoves = [
        moves[index],
        ...moves.slice(0, index),
        ...moves.slice(index + 1),
      ];
    }
  }
  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  const historyAtRoot = state.history.length;
  try {
    for (const move of rootMoves) {
      makeMove(state, move);
      const score = -negamax(
        state,
        depth - 1,
        -Infinity,
        Infinity,
        1,
        evaluate,
        ordered,
        ordering,
        shouldAbort,
      );
      unmakeMove(state);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
  } catch (error) {
    // An aborted iteration (task 3.4) throws mid-recursion: the exception
    // unwinds past every unmakeMove along the aborted path, so the
    // caller's state is left several plies deep. Restore it exactly
    // before rethrowing — the caller's copy must always be legal-queryable.
    while (state.history.length > historyAtRoot) {
      unmakeMove(state);
    }
    throw error;
  }
  return { move: bestMove, score: bestScore, nodes: ordering.nodes };
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
