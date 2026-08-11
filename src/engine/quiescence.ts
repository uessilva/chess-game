import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { MoveFlags } from '../core/types';
import { evaluate as defaultEvaluate } from './eval';
import { mvvLvaScore } from './moveOrdering';
import {
  MATE_SCORE,
  scoreFromTT,
  scoreToTT,
  ttCutoffScore,
  type Evaluator,
} from './search';
import type { Bound, TranspositionTable, TTMove } from './transpositionTable';

/**
 * Quiescence search (task 3.6, #21): extends the fixed-depth alpha-beta
 * search past its horizon by searching ONLY forcing moves — captures and
 * promotions — until the position is quiet, using the standard stand-pat
 * cutoff to keep the tree bounded. This resolves the horizon effect: a
 * depth-N search that returns the raw static evaluation at the horizon can
 * blunder when that evaluation hides unresolved tactics (a hanging piece,
 * a recapture, a pending promotion).
 *
 * Pure module: depends on `src/core` only (no DOM, no I/O), so it runs
 * unchanged in the Web Worker, in the browser, and in Node tests. It
 * consumes core exactly as exported — `generateLegalMoves`, `makeMove` /
 * `unmakeMove`, `isInCheck` — so every searched move is perft-verified
 * legal and every recursion restores the state.
 *
 * ## Search policy at each qsearch node
 *
 * - **In check** (the side to move): never stand pat. All legal moves
 *   (evasions, which may be quiet) are generated and searched; if none
 *   exist the node is checkmate and a mate score is returned with the
 *   same convention as #17 (`-(MATE_SCORE - ply)`, distance-adjusted).
 * - **Not in check**: stand pat — compute the static evaluation (#16). If
 *   `eval >= beta` the node returns beta immediately without expanding a
 *   single capture move (Scenario 6); otherwise `alpha = max(alpha, eval)`
 *   and the tactical moves are searched. A non-check node with no capture
 *   or promotion moves is a leaf and returns the stand-pat score.
 * - **Tactical move set**: only `MoveFlags.CAPTURE` (incl. `EN_PASSANT`)
 *   and `PROMOTION` moves — a back-rank push promotes even without a
 *   capture, and underpromotions are included (the promotion piece is
 *   chosen by search, e.g. Scenario 3 promotes to queen, not rook). Quiet
 *   moves are never searched outside of check: that is the boundedness
 *   guarantee.
 * - **Ordering**: the tactical list is ordered with #18's MVV-LVA
 *   comparator (`mvvLvaScore`) before recursing; a stored TT move is
 *   tried first. Standard alpha-beta window; `makeMove` / `unmakeMove`
 *   from core for every tried move.
 *
 * ## Integration with the main search (#17/#19)
 *
 * `search` calls `quiescenceSearch` at its horizon (depth 0) instead of
 * returning the raw static evaluation when `SearchOptions.qsearch` is
 * set. The base `ply` is passed in so mate scores stay measured from the
 * root, and the stop flag from #19's time management is checked inside
 * qsearch so a capture chain cannot overrun the time budget: when the
 * flag fires, the node returns the best score found so far (truncated)
 * instead of expanding further.
 *
 * ## Transposition table (#20)
 *
 * Qsearch nodes store and consult the TT (key = `state.zobristKey` from
 * core; same entry format, depth-preferred replacement, and full-key
 * collision policy as #20). Qsearch entries are stored at depth 0, so a
 * repeated position is served from the TT rather than re-searched, and
 * deeper main-search entries are also usable at qsearch nodes. Truncated
 * (aborted) results are never stored.
 *
 * ## Explosion safety
 *
 * A configurable maximum qsearch ply (`options.maxPly`, default 8) caps
 * the capture chain; past the cap the node returns the static evaluation.
 * The terminal check runs before the cap so a mate at the cap is still
 * scored as a mate. The default is far beyond any capture chain the
 * scenarios exercise, so it is purely a safety net.
 *
 * ## Scoring convention
 *
 * The returned score is negamax-compatible from the side-to-move's
 * perspective (positive = the side to move is better), exactly like
 * `evaluate` (#16) and `search` (#17): recursion negates at each ply with
 * no colour special-casing.
 */

/** The default max-ply safety net (the issue's "default ~4–8"). */
const DEFAULT_MAX_PLY = 8;

/**
 * True for a move qsearch may search outside of check: a capture (en
 * passant carries CAPTURE) or a promotion (a back-rank push promotes even
 * without a capture). Quiet moves are the boundedness guarantee — they are
 * only searched as check evasions.
 */
function isTactical(move: Move): boolean {
  return (move.flags & (MoveFlags.CAPTURE | MoveFlags.PROMOTION)) !== 0;
}

/**
 * True when a move captures the enemy king. Impossible in a legal
 * position — `generateLegalMoves` only filters the MOVER's king safety,
 * so a crafted FEN with the enemy king en prise (e.g. scenario 3's
 * `6k1/7P/...` — the h7 pawn attacks g8) yields "legal" king captures.
 * Searching one would leave a king-less position whose terminal scoring
 * cannot ask `isInCheck`. Real engines never search king captures, so
 * qsearch drops them.
 */
function isKingCapture(state: BoardState, move: Move): boolean {
  if (move.flags & MoveFlags.EN_PASSANT) {
    return false;
  }
  const target = state.board[move.to];
  return (
    target !== null && target.type === 'king' && target.color !== state.turn
  );
}

/** The minimal TT descriptor for a generated move. */
function ttMoveOf(move: Move): TTMove {
  return { from: move.from, to: move.to, promotion: move.promotion };
}

/** True when a generated move matches a stored transposition-table move. */
function sameTTMove(move: Move, ttMove: TTMove): boolean {
  return (
    move.from === ttMove.from &&
    move.to === ttMove.to &&
    move.promotion === ttMove.promotion
  );
}

/**
 * Qsearch knobs. `maxPly` is the explosion safety net (default 8); `ply`
 * is the base ply for mate-distance scoring (0 for standalone calls; the
 * main search passes its own ply so mates stay measured from the root).
 * `shouldAbort` is #19's cooperative deadline: when it turns true the node
 * returns the best score found so far instead of expanding further. `tt`
 * is #20's optional transposition table. `evaluate` defaults to #16's
 * evaluation and can be injected so unit tests use a deterministic stub.
 */
export interface QuiescenceOptions {
  /** Evaluator injection (defaults to #16's `evaluate`). */
  readonly evaluate?: Evaluator;
  /**
   * Base ply for mate-distance scoring: 0 for standalone calls, the
   * main search's ply when integrated (so a qsearch mate is reported at
   * the same distance from the root as a main-search mate).
   */
  readonly ply?: number;
  /** Max qsearch ply safety net (positive integer, default 8). */
  readonly maxPly?: number;
  /**
   * Cooperative deadline check (#19): when true, the node returns the
   * best score found so far — truncated — instead of expanding further,
   * so a capture chain cannot overrun the time budget.
   */
  readonly shouldAbort?: () => boolean;
  /** Optional transposition table (#20); qsearch probes before movegen
   * and stores after searching. */
  readonly tt?: TranspositionTable | null;
}

/** What a qsearch call returns: the score plus the work it did. */
export interface QuiescenceResult {
  /**
   * The negamax-compatible score for the side to move (same conventions
   * as #17). When `aborted` is true this is the best score found before
   * the stop flag fired, not the full qsearch value.
   */
  readonly score: number;
  /**
   * Positions visited by this qsearch: the root plus every recursion.
   * The main search adds these to its own node counter.
   */
  readonly nodes: number;
  /** True when the stop flag fired and the score is truncated. */
  readonly aborted: boolean;
}

/**
 * Depth validation, perft-harness style: a non-positive or non-integer
 * maxPly is a caller bug, not a silently-unevaluated node.
 */
function assertValidMaxPly(maxPly: number): void {
  if (!Number.isInteger(maxPly) || maxPly < 1) {
    throw new Error(
      `quiescenceSearch: maxPly must be a positive integer, got ${maxPly}`,
    );
  }
}

/**
 * The quiescence search root. Returns the score of the position for the
 * side to move after resolving all forcing tactics at the horizon, plus
 * the number of positions visited and whether the stop flag truncated the
 * search. `alpha`/`beta` form the standard negamax window; the caller
 * negates the result after `makeMove`, exactly like `search` (#17).
 */
export function quiescenceSearch(
  state: BoardState,
  alpha: number,
  beta: number,
  options: QuiescenceOptions = {},
): QuiescenceResult {
  const evaluate = options.evaluate ?? defaultEvaluate;
  const basePly = options.ply ?? 0;
  const maxPly = options.maxPly ?? DEFAULT_MAX_PLY;
  const shouldAbort = options.shouldAbort;
  const tt = options.tt ?? null;
  assertValidMaxPly(maxPly);

  let nodes = 0;

  /** One qsearch node; the alpha-beta recursion with negation. */
  function qsearch(
    alpha: number,
    beta: number,
    ply: number,
  ): { score: number; aborted: boolean } {
    nodes++;
    // The stop flag (#19) is honored inside qsearch so a capture chain
    // cannot overrun the time budget. When it fires at node entry the
    // node is not expanded: the static evaluation is returned as the
    // (truncated) score and nothing is stored in the TT.
    if (shouldAbort !== undefined && shouldAbort()) {
      return { score: evaluate(state), aborted: true };
    }

    // Transposition-table probe (#20): a full-key-verified entry searched
    // to at least the requested depth can cut the whole subtree before a
    // single move is generated. Qsearch entries are stored at depth 0 and
    // deeper main-search entries are also usable. The score is converted
    // back from table coordinates to this node's ply.
    let ttMove: TTMove | null = null;
    if (tt !== null) {
      const entry = tt.probe(state.zobristKey, 0);
      if (entry !== null) {
        const stored = scoreFromTT(entry.score, ply);
        const cutoff = ttCutoffScore(entry.bound, stored, alpha, beta);
        if (cutoff.cutoff) {
          return { score: cutoff.score, aborted: false };
        }
        ttMove = entry.move;
      }
    }

    // King captures are impossible in legal play and would leave a
    // king-less position the terminal scoring cannot handle; drop them
    // (defensive — they only appear from crafted FENs like scenario 3).
    const moves = generateLegalMoves(state).filter(
      (move) => !isKingCapture(state, move),
    );
    if (moves.length === 0) {
      // Terminal: exact and depth-independent (after ply adjustment), so
      // it is stored so a later probe of the same position skips movegen.
      const score = isInCheck(state, state.turn) ? -(MATE_SCORE - ply) : 0;
      if (tt !== null) {
        tt.store(state.zobristKey, 0, scoreToTT(score, ply), 'exact', null);
      }
      return { score, aborted: false };
    }

    // Explosion safety net: past the max-ply cap the capture chain is not
    // expanded. The terminal check above runs first, so a mate at the cap
    // is still scored as a mate.
    if (ply >= maxPly) {
      return { score: evaluate(state), aborted: false };
    }

    const inCheck = isInCheck(state, state.turn);
    let best: number;
    if (!inCheck) {
      // Stand pat: the static evaluation is the value of doing nothing.
      // When it already meets the beta bound the node returns beta
      // immediately, without expanding a single capture move — the
      // boundedness guarantee (Scenario 6).
      const standPat = evaluate(state);
      if (standPat >= beta) {
        return { score: beta, aborted: false };
      }
      best = standPat;
      if (standPat > alpha) {
        alpha = standPat;
      }
    } else {
      // In check: never stand pat. All legal evasions are searched (they
      // may be quiet); a node with no evasions is checkmate, handled above.
      best = -Infinity;
    }

    // In-check nodes search ALL legal moves; otherwise only the tactical
    // (capture/promotion) subset. A non-check node with no tactical moves
    // is a leaf: its value is the stand-pat score.
    let searched = inCheck ? moves : moves.filter(isTactical);
    if (searched.length === 0) {
      return { score: best, aborted: false };
    }

    // Order with #18's MVV-LVA comparator before recursing: most-valuable
    // victim first, least-valuable attacker breaking victim ties. A pure
    // permutation — ties keep generation order (Array#sort is stable) —
    // so the searched set is identical to an unordered search.
    searched = [...searched].sort(
      (a, b) => mvvLvaScore(state, b) - mvvLvaScore(state, a),
    );
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
    let bestMove: Move | null = null;
    let aborted = false;
    for (const move of searched) {
      makeMove(state, move);
      const child = qsearch(-beta, -alpha, ply + 1);
      unmakeMove(state);
      // The child's score is from the child's (opponent's) perspective —
      // negate it, exactly like negamax (#17).
      const score = -child.score;
      if (score > best) {
        best = score;
        bestMove = move;
      }
      if (best > alpha) {
        alpha = best;
      }
      if (alpha >= beta) {
        break;
      }
      // The stop flag is re-checked after every child so an expiring
      // budget returns the best score found so far without expanding the
      // rest of the capture chain.
      if (shouldAbort !== undefined && shouldAbort()) {
        aborted = true;
        break;
      }
    }

    // Truncated results are never stored: their scores were not fully
    // resolved and could poison later probes.
    if (aborted) {
      return { score: best, aborted: true };
    }

    // The alpha-beta node type: fail high → lower bound (the true score
    // is at least `best`); fail low → upper bound (at most `best`);
    // otherwise the value was resolved inside the window → exact.
    const bound: Bound =
      best >= beta ? 'lower' : best > alphaOrig ? 'exact' : 'upper';
    if (tt !== null) {
      tt.store(
        state.zobristKey,
        0,
        scoreToTT(best, ply),
        bound,
        bestMove === null ? null : ttMoveOf(bestMove),
      );
    }
    return { score: best, aborted: false };
  }

  const root = qsearch(alpha, beta, basePly);
  return { score: root.score, nodes, aborted: root.aborted };
}
