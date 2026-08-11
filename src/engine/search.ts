import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { MoveFlags } from '../core/types';
import { evaluate as defaultEvaluate } from './eval';
import { MoveOrdering } from './moveOrdering';
import { quiescenceSearch } from './quiescence';
import type { Bound, TranspositionTable, TTMove } from './transpositionTable';

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
 *
 * Task 3.5 (#20) adds the optional transposition table (`SearchOptions.tt`).
 * When provided, every node probes before generating moves and stores
 * after searching (full-key verified, depth-honoring — see
 * transpositionTable.ts); the stored best move is tried first, feeding
 * #18's ordering. The TT never changes the answer: at equal depth it
 * returns the same best move and score as a no-TT search — it only finds
 * them faster (fewer nodes). It is a strict opt-in so the default search
 * stays fully deterministic, node counts included.
 */

/**
 * The score of a checkmate. Far above any material/PST total (centipawns),
 * so a mating line always outranks a merely winning one. Root mate scores
 * are `MATE_SCORE + ply`, which is why the value itself must be large
 * enough to dwarf any static evaluation sum.
 */
export const MATE_SCORE = 1_000_000;

/**
 * The deepest ply the search can report a mate from. Mate scores are
 * ply-adjusted for the transposition table (below), and any score whose
 * magnitude is within `MAX_TT_PLY` of `MATE_SCORE` is treated as a mate
 * score. 512 plies is far beyond the engine's depth caps (the worker's
 * depth knob) and far above the ~10K-centipawn ceiling of any material
 * + PST total, so the classification is unambiguous.
 */
const MAX_TT_PLY = 512;

/** Scores above this magnitude are mate scores, not centipawn totals. */
const MATE_THRESHOLD = MATE_SCORE - MAX_TT_PLY;

/**
 * Convert a score found at `ply` to transposition-table coordinates:
 * mate scores are rewritten to be measured from the position itself, so
 * the stored value is independent of the ply the position was reached
 * at ("mate in k plies from here"), and entries stay valid across
 * searches and across transpositions. Non-mate (centipawn) scores pass
 * through unchanged.
 */
export function scoreToTT(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) {
    return score + ply;
  }
  if (score < -MATE_THRESHOLD) {
    return score - ply;
  }
  return score;
}

/**
 * Invert `scoreToTT`: convert a stored table score back to the current
 * search's coordinates at `ply`. A stored mate-in-k becomes
 * `MATE_SCORE - k - ply` (or its negation) at this ply, so "mate in N"
 * stays measured from the root consistently — the classic TT
 * correctness trap; the test suite shows no mate-score regression.
 */
export function scoreFromTT(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) {
    return score - ply;
  }
  if (score < -MATE_THRESHOLD) {
    return score + ply;
  }
  return score;
}

/** The leaf scoring function: a side-to-move-relative score. */
export type Evaluator = (state: BoardState) => number;

/**
 * The TT cutoff rule at a node: a probed entry is usable as a cutoff
 * only when its bound matches the window — `exact` always; `lower` only
 * when the stored score is at least beta (fail high); `upper` only when
 * the stored score is at most alpha (fail low). An `upper` entry never
 * causes a fail-high and a `lower` entry never a fail-low: a bound
 * proves the true score lies on one side of the stored value, and a
 * cutoff is only valid in the direction the bound was proven. When the
 * bound does not match, `cutoff` is false and the caller re-searches,
 * using the stored move only as the first-move hint.
 */
export function ttCutoffScore(
  bound: Bound,
  stored: number,
  alpha: number,
  beta: number,
): { cutoff: boolean; score: number } {
  if (bound === 'exact') {
    return { cutoff: true, score: stored };
  }
  if (bound === 'lower') {
    return stored >= beta
      ? { cutoff: true, score: stored }
      : { cutoff: false, score: stored };
  }
  return stored <= alpha
    ? { cutoff: true, score: stored }
    : { cutoff: false, score: stored };
}

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
  /**
   * Optional transposition table (task 3.5): when provided, every node
   * probes before generating moves and stores after searching, and the
   * stored best move feeds move ordering. Strict opt-in — without it the
   * search is byte-for-byte the pre-TT search (same moves, scores, and
   * node counts), so existing callers and determinism tests are
   * unaffected. A fresh generation is ticked at the start of the search.
   */
  readonly tt?: TranspositionTable | null;
  /**
   * Task 3.6 (#21): when true, the depth-0 horizon is extended by the
   * quiescence search instead of returning the raw static evaluation —
   * captures and promotions are searched past the horizon until the
   * position is quiet (see quiescence.ts), resolving the horizon effect.
   * `shouldAbort` and `tt` are passed through, so the deadline is honored
   * inside qsearch and qsearch nodes share the transposition table. A
   * deadline that fires inside a qsearch chain aborts the whole iteration
   * like any other node: `search` throws `SearchTimeoutError` and never
   * stores the truncated score in the TT.
   * Default false, so the default search is byte-for-byte the pre-qsearch
   * search (same moves, scores, and node counts) — the same strict opt-in
   * policy as the TT.
   *
   * NOTE (shared-TT footgun): the TT is caller-owned and shared across
   * searches, and depth-0 entries are mode-dependent — a raw-eval entry
   * stored by a non-qsearch search can be probed as a cutoff by a later
   * qsearch node and vice versa. Keep the qsearch setting stable for the
   * lifetime of a table, or use a separate table per mode.
   */
  readonly qsearch?: boolean;
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

/** True when a generated move matches a stored transposition-table move. */
function sameTTMove(move: Move, ttMove: TTMove): boolean {
  return (
    move.from === ttMove.from &&
    move.to === ttMove.to &&
    move.promotion === ttMove.promotion
  );
}

/** The minimal TT descriptor for a generated move. */
function ttMoveOf(move: Move): TTMove {
  return { from: move.from, to: move.to, promotion: move.promotion };
}

/**
 * Negamax over `generateLegalMoves(state)`, recursing with makeMove /
 * unmakeMove. Returns the best score from the side to move's perspective.
 * Terminal nodes are scored before the depth check so a checkmate is
 * always a mate score, never a static evaluation. When `ordered` is set,
 * each node's moves are reordered first (MVV-LVA, killers, history) and a
 * quiet move that cuts beta is recorded as a killer and a history bonus —
 * this never changes the minimax result, only how early cutoffs happen.
 *
 * When `tt` is provided, the node probes before generating any move: a
 * full-key-verified entry searched to at least `depth` whose bound
 * matches the window (see `ttCutoffScore`) returns immediately — the
 * whole subtree is skipped. Otherwise the entry's best move is moved to
 * the front of the move list (a pure permutation — the position is
 * identical by key, so the move is legal) and the node re-searches. The
 * result is stored back at the end with the ply-adjusted score and the
 * alpha-beta node type. The TT never changes the minimax answer; it only
 * removes re-expanded transpositions.
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
  tt: TranspositionTable | null,
  qsearchEnabled: boolean,
): number {
  ordering.nodes++;
  // Cooperative deadline: the iterative-deepening wrapper abandons an
  // in-flight iteration by throwing; the node was visited, so it is
  // counted before the throw. Depth 1 is exempt by design — the wrapper
  // never passes shouldAbort for it (the floor guarantee).
  if (shouldAbort !== undefined && shouldAbort()) {
    throw new SearchTimeoutError(ordering.nodes);
  }

  // Transposition-table probe: a matching entry can cut the whole
  // subtree before a single move is generated. The score is converted
  // back from table coordinates to this node's ply.
  let ttMove: TTMove | null = null;
  if (tt !== null) {
    const entry = tt.probe(state.zobristKey, depth);
    if (entry !== null) {
      const stored = scoreFromTT(entry.score, ply);
      const cutoff = ttCutoffScore(entry.bound, stored, alpha, beta);
      if (cutoff.cutoff) {
        return cutoff.score;
      }
      ttMove = entry.move;
    }
  }

  const moves = generateLegalMoves(state);
  let best: number;
  let bestMove: Move | null = null;
  let bound: Bound;
  if (moves.length === 0) {
    // Terminal: exact and depth-independent (after ply adjustment), so it
    // is stored so a later probe of the same position skips the movegen.
    best = isInCheck(state, state.turn) ? -(MATE_SCORE - ply) : 0;
    bound = 'exact';
  } else if (depth === 0) {
    // The static evaluation IS the exact depth-0 value — unless task 3.6's
    // qsearch is enabled, in which case the horizon is extended: captures
    // and promotions are searched past the horizon until the position is
    // quiet (see quiescence.ts). The qsearch root is this node — already
    // counted by the entry increment above — so only its descendants add
    // to the search-wide node counter; the base ply is this node's ply so
    // mate scores stay measured from the root.
    if (qsearchEnabled) {
      const q = quiescenceSearch(state, alpha, beta, {
        ply,
        evaluate,
        shouldAbort,
        tt,
      });
      ordering.nodes += q.nodes - 1;
      if (q.aborted) {
        // A truncated qsearch result is never stored (quiescence.ts's own
        // rule: its score was not fully resolved and could poison later
        // probes) and must never surface as a completed value. Propagate
        // the abort exactly like a mid-tree deadline hit, so the
        // iterative-deepening wrapper discards the whole iteration — the
        // throw also skips the TT store below.
        throw new SearchTimeoutError(ordering.nodes);
      }
      best = q.score;
    } else {
      best = evaluate(state);
    }
    bound = 'exact';
  } else {
    let searched = ordered ? ordering.orderMoves(state, moves, ply) : moves;
    // A stored best move from a previous search of this identical position
    // is tried first — feeds #18's move ordering (a pure permutation).
    if (ttMove !== null) {
      const index = searched.findIndex((move) => sameTTMove(move, ttMove));
      if (index > 0) {
        searched = [
          searched[index],
          ...searched.slice(0, index),
          ...searched.slice(index + 1),
        ];
      }
    }
    const alphaOrig = alpha;
    best = -Infinity;
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
        tt,
        qsearchEnabled,
      );
      unmakeMove(state);
      if (score > best) {
        best = score;
        bestMove = move;
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
    // The alpha-beta node type: fail high → lower bound (the true score
    // is at least `best`); fail low → upper bound (at most `best`);
    // otherwise the value was resolved inside the window → exact.
    bound = best >= beta ? 'lower' : best > alphaOrig ? 'exact' : 'upper';
  }

  if (tt !== null) {
    tt.store(
      state.zobristKey,
      depth,
      scoreToTT(best, ply),
      bound,
      bestMove === null ? null : ttMoveOf(bestMove),
    );
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
 *   evaluation (or the qsearch-resolved value when `qsearch` is enabled:
 *   the depth-0 horizon is extended at the root too).
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
  const tt = options.tt ?? null;
  const qsearchEnabled = options.qsearch ?? false;
  if (tt !== null) {
    // Entries stored by earlier searches stay probeable, but get replaced
    // first on collision (see transpositionTable.ts replacement policy).
    tt.newGeneration();
  }
  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return {
      move: null,
      score: isInCheck(state, state.turn) ? -MATE_SCORE : 0,
      nodes: 1,
    };
  }
  if (depth === 0) {
    if (qsearchEnabled) {
      // The documented depth-0 horizon extension applies at the root too:
      // resolve the position's tactics instead of returning the raw eval.
      // The root is searched with the infinite window, exactly like the
      // root of a deeper search.
      const q = quiescenceSearch(state, -Infinity, Infinity, {
        evaluate,
        shouldAbort,
        tt,
      });
      if (q.aborted) {
        throw new SearchTimeoutError(q.nodes);
      }
      return { move: null, score: q.score, nodes: q.nodes };
    }
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
        tt,
        qsearchEnabled,
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
