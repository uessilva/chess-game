import { generateLegalMoves, isInCheck } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { evaluate as defaultEvaluate } from './eval';
import type { Evaluator } from './search';
import { MATE_SCORE, search, SearchTimeoutError } from './search';
import type { TranspositionTable } from './transpositionTable';

/**
 * Iterative deepening + time management (task 3.4): wrap the fixed-depth
 * negamax/alpha-beta search (#17) so the engine can "think for X ms" and
 * always hand back a clean, legal move.
 *
 * The wrapper runs the depth-limited search at depths 1, 2, 3, … until the
 * time budget expires. Each iteration searches the previous iteration's
 * best move (the PV move) first at the root — task 3.3's ordering (MVV-LVA,
 * killers, history) is the hard prerequisite that makes the re-search cheap
 * enough to be viable. When the deadline passes, the in-flight iteration is
 * abandoned and the best move of the last **fully completed** iteration is
 * returned: a move from an aborted, unverified iteration never surfaces
 * (the "clean stop"). The overrun is bounded by one iteration's work.
 *
 * Floor guarantee: depth 1 always runs to completion before the deadline is
 * honored, so in any position with at least one legal move the engine
 * returns a legal move even with a budget that is already exhausted.
 *
 * Deterministic testing: `now` (default `performance.now()`, available in
 * the Web Worker) is injectable, so tests simulate budget expiry with a
 * fake clock and never sleep on a real timer.
 *
 * Pure module: depends on `src/core` only (no DOM, no I/O), so it runs
 * unchanged in the Web Worker, in the browser, and in Node tests — and it
 * adds no `src/core/` changes, keeping the perft oracle untouched.
 */

/**
 * Time-search options. `timeMs` is the budget; `now` is the injectable
 * clock (`performance.now()` in the worker); `maxDepth` is an optional
 * safety cap on deepening (the UI's existing engine-depth knob).
 */
export interface TimeSearchOptions {
  /** The search budget in milliseconds. */
  readonly timeMs: number;
  /** Injectable clock; defaults to `performance.now()`. */
  readonly now?: () => number;
  /**
   * Optional ceiling on iterative deepening: stop after this depth even
   * if the budget is not spent. Defaults to unlimited (the budget is the
   * normal stopping condition).
   */
  readonly maxDepth?: number;
  /**
   * Optional transposition table (task 3.5) kept across iterations, so
   * each deeper iteration reuses the previous ones' entries. When
   * provided, every fixed-depth iteration probes and stores; the result
   * (move/score) is unchanged — only node counts drop. Defaults to no
   * TT, preserving the pre-TT behavior exactly.
   */
  readonly tt?: TranspositionTable | null;
  /**
   * Task 3.6 (#21): when true, every fixed-depth iteration extends its
   * horizon with the quiescence search instead of the raw static
   * evaluation (see SearchOptions.qsearch). The stop flag is passed into
   * qsearch, so an expiring budget also truncates an in-flight capture
   * chain. Defaults to false, preserving the pre-qsearch behavior exactly.
   */
  readonly qsearch?: boolean;
}

/** What the time-budgeted search returns. */
export interface TimeSearchResult {
  /** The chosen move, or null when the side to move has no legal moves. */
  readonly move: Move | null;
  /**
   * The root score in centipawns from the side to move's perspective
   * (negamax-compatible with #16). A forced mate scores near MATE_SCORE
   * (distance-adjusted per #17).
   */
  readonly score: number;
  /** The deepest fully completed iteration (0 for a terminal position). */
  readonly depth: number;
  /**
   * Total nodes searched across all iterations, including the partial
   * work of an aborted iteration (the engine's own node counter).
   */
  readonly nodes: number;
  /** Elapsed milliseconds, measured with the injected clock. */
  readonly elapsedMs: number;
}

const defaultNow: () => number = () => performance.now();

/**
 * `maxDepth` is a positive integer or Infinity (the default). Zero or a
 * fraction would contradict the floor guarantee — depth 1 must always
 * run — so like the fixed-depth search's depth validation, it is a caller
 * bug, not a silent no-search result.
 */
function assertValidMaxDepth(maxDepth: number): void {
  if (maxDepth !== Number.POSITIVE_INFINITY) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error(
        `searchWithTime: maxDepth must be a positive integer or Infinity, got ${maxDepth}`,
      );
    }
  }
}

/**
 * Run the time-budgeted iterative-deepening search. Returns the best move
 * of the last fully completed iteration, the deepest completed depth, the
 * total node count, and the elapsed time.
 *
 * Terminal position (no legal moves): `move` is null, `score` is
 * `-MATE_SCORE` when the side to move is checkmated and `0` when it is
 * stalemated — matching #17's fixed-depth convention.
 *
 * The deadline is honored cooperatively: the fixed-depth search checks it
 * at every node of iterations deeper than 1 and throws `SearchTimeoutError`
 * when it passes; the wrapper discards that partial iteration and falls
 * back to the previous completed one. Depth 1 never aborts, so the floor
 * guarantee holds even for an already-exhausted budget.
 */
export function searchWithTime(
  state: BoardState,
  options: TimeSearchOptions,
  evaluate: Evaluator = defaultEvaluate,
): TimeSearchResult {
  const now = options.now ?? defaultNow;
  const start = now();
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const timeMs = options.timeMs;
  assertValidMaxDepth(maxDepth);

  const moves = generateLegalMoves(state);
  if (moves.length === 0) {
    return {
      move: null,
      score: isInCheck(state, state.turn) ? -MATE_SCORE : 0,
      depth: 0,
      nodes: 1,
      elapsedMs: now() - start,
    };
  }

  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  let completedDepth = 0;
  let totalNodes = 0;
  let elapsed = 0; // set after each completed iteration (and on abort)

  for (let depth = 1; depth <= maxDepth; depth++) {
    // The previous iteration's best move is searched first at the root;
    // it is null on the first iteration, so the natural order is kept.
    const pvMove = bestMove;
    // Depth 1 always runs to completion (floor guarantee): no deadline
    // check. Deeper iterations abort cooperatively when the budget is spent.
    const shouldAbort = depth === 1 ? undefined : () => now() - start >= timeMs;
    let iteration;
    try {
      iteration = search(state, depth, evaluate, {
        pvMove,
        shouldAbort,
        tt: options.tt ?? null,
        qsearch: options.qsearch,
      });
    } catch (error) {
      if (error instanceof SearchTimeoutError) {
        // The in-flight iteration was abandoned mid-search: count the
        // partial work it did, then keep the last completed iteration's
        // result — a move from an aborted iteration never surfaces.
        totalNodes += error.nodes;
        elapsed = now() - start;
        break;
      }
      throw error;
    }
    totalNodes += iteration.nodes;
    elapsed = now() - start;
    // The iteration completed: it is now the last fully completed one.
    bestMove = iteration.move;
    bestScore = iteration.score;
    completedDepth = depth;
    if (iteration.move === null) {
      break; // defensive: the root had no legal moves
    }
    if (elapsed >= timeMs) {
      break; // budget spent — stop before starting another iteration
    }
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: completedDepth,
    nodes: totalNodes,
    elapsedMs: elapsed,
  };
}
