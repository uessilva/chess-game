import { fileOf, rankOf, square } from '../core/board';
import type { BoardState } from '../core/state';
import type { Move, PieceType } from '../core/types';
import { MoveFlags } from '../core/types';

/**
 * Move ordering (task 3.3) — MVV-LVA captures, killer moves, and the
 * history heuristic, layered onto the negamax/alpha-beta search (#17).
 *
 * Ordering only ever reorders the legal move list produced by
 * `generateLegalMoves`; it never changes WHICH moves are searched, so
 * `core/` stays untouched and the perft fixtures remain the correctness
 * oracle. Each ordering layer contributes a category bonus to a move's
 * sort key, so the final order is always:
 *
 *   1. captures, MVV-LVA (most valuable victim first; among equal
 *      victims the least valuable attacker first) — including promotion
 *      captures, which carry both bonuses;
 *   2. killer moves for the current ply, validated against the current
 *      position's legal move set (a stale killer from a sibling branch
 *      is skipped, never searched blindly);
 *   3. promotions (ahead of quiet moves; promotions sort after captures
 *      and killers per the issue's "right after captures" wording);
 *   4. remaining quiet moves by descending history score.
 *
 * Equal scores keep `moves`' original generation order (Array#sort is
 * stable), so ordering is deterministic: same position, same ordering
 * state, same result. No SEE (static exchange evaluation) in this task —
 * a losing capture ordered too high is accepted, SEE belongs with
 * quiescence (#21).
 *
 * A fresh `MoveOrdering` is created for every root search, so the killer
 * slots and history table reset per search (per root position). The
 * search also keeps its node counter here: it is per-search state and
 * both the ordered and unordered runs increment it.
 */

/**
 * Relative piece values for MVV-LVA ordering, per the issue spec (pawn
 * 100, knight 300, bishop 300, rook 500, queen 900; no king value — no
 * move captures a king). Deliberately independent from the #16 eval
 * values: ordering uses its own magnitude and evaluation its own.
 */
export const MVV_LVA_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 300,
  bishop: 300,
  rook: 500,
  queen: 900,
  king: 0,
};

/** Category bonuses; each level is wide enough that no lower level can overlap. */
const CAPTURE_BASE = 1_000_000;
const KILLER_BASE = 100_000;
const PROMOTION_BASE = 50_000;

/** Number of killer slots per ply (2 is conventional). */
const KILLER_SLOTS = 2;

/** Guard for an out-of-range ply (caller bug; see MoveOrdering). */
const EMPTY_KILLERS: readonly number[] = [];

/**
 * A move's identity key for the killer slots and history table: the
 * packed from/to squares. A from/to pair identifies a move uniquely
 * (exactly one piece stands on `from`). Promotion moves share the key of
 * their underlying push/capture — harmless because the tables only ever
 * receive quiet moves.
 */
function moveKey(move: Move): number {
  return move.from * 128 + move.to;
}

/**
 * The victim of a capture: the piece on the target square, or the pawn
 * beside the mover for an en-passant capture (whose target square is
 * empty). Null when the board disagrees with the flags — unreachable
 * through generateLegalMoves, kept for type safety.
 */
function victimPiece(state: BoardState, move: Move): PieceType | null {
  if (move.flags & MoveFlags.EN_PASSANT) {
    return (
      state.board[square(fileOf(move.to), rankOf(move.from))]?.type ?? null
    );
  }
  return state.board[move.to]?.type ?? null;
}

/**
 * MVV-LVA score for a capture: most-valuable victim first; among equal
 * victims the least-valuable attacker first. `victim * 1000 - attacker`
 * makes the victim value dominate while the attacker value only breaks
 * victim ties.
 */
export function mvvLvaScore(state: BoardState, move: Move): number {
  const victim = victimPiece(state, move);
  const victimValue = victim === null ? 0 : MVV_LVA_VALUES[victim];
  return victimValue * 1000 - MVV_LVA_VALUES[move.piece];
}

/**
 * Per-search move-ordering state: killer slots, the history table, and
 * the search's node counter. Methods are called by the search
 * (`orderMoves` before iterating a node's moves; `recordKiller` /
 * `recordHistory` after a quiet move cuts beta) and directly by unit
 * tests to assert each layer in isolation.
 */
export class MoveOrdering {
  /** Killer move keys per ply, newest first, two slots each. */
  private readonly killers: number[][];
  /** History score per move key; absent means a score of 0. */
  private readonly history = new Map<number, number>();
  /**
   * Node counter for the search: incremented once per position the
   * search visits (the root plus every negamax call). Task 3.3's
   * acceptance gate — strictly lower with ordering enabled — compares
   * this across ordered/unordered runs.
   */
  nodes = 0;

  /**
   * @param maxDepth The search depth: killer slots are sized for plies
   *   0..maxDepth, so any ply the search can reach stays in range.
   */
  constructor(maxDepth: number) {
    this.killers = Array.from({ length: maxDepth + 1 }, () =>
      Array<number>(KILLER_SLOTS).fill(-1),
    );
  }

  /**
   * Reorder a legal move list for the search at `ply`: captures first
   * (MVV-LVA), then this ply's validated killers, then promotions, then
   * quiet moves by descending history score. A pure permutation of
   * `moves` — never drops, duplicates, or invents a move — so the set of
   * searched moves is identical to unordered search.
   */
  orderMoves(state: BoardState, moves: Move[], ply: number): Move[] {
    const killerKeys =
      ply >= 0 && ply < this.killers.length ? this.killers[ply] : EMPTY_KILLERS;
    const legalKeys = new Set<number>();
    for (const move of moves) {
      legalKeys.add(moveKey(move));
    }
    const scored = moves.map((move) => ({
      move,
      score: this.moveScore(state, move, killerKeys, legalKeys),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.move);
  }

  /**
   * Record a quiet move that caused a beta cutoff at `ply` as a killer.
   * Re-recording the newest slot is a no-op; otherwise the newest entry
   * pushes the previous one out (2 slots per ply).
   */
  recordKiller(move: Move, ply: number): void {
    if (ply < 0 || ply >= this.killers.length) {
      return;
    }
    const slots = this.killers[ply];
    const key = moveKey(move);
    if (slots[0] === key) {
      return;
    }
    slots[1] = slots[0];
    slots[0] = key;
  }

  /**
   * Add a depth-scaled bonus (depth squared) for a quiet move that
   * failed high (cut beta). Repeated cutoffs across sibling branches
   * accumulate, so the move keeps rising in the quiet-move order.
   */
  recordHistory(move: Move, depth: number): void {
    const key = moveKey(move);
    this.history.set(key, (this.history.get(key) ?? 0) + depth * depth);
  }

  /** The full ordering score for one move at the current node. */
  private moveScore(
    state: BoardState,
    move: Move,
    killerKeys: readonly number[],
    legalKeys: ReadonlySet<number>,
  ): number {
    const isCapture = (move.flags & MoveFlags.CAPTURE) !== 0;
    const isPromotion = (move.flags & MoveFlags.PROMOTION) !== 0;
    let score = 0;
    if (isCapture) {
      score += CAPTURE_BASE + mvvLvaScore(state, move);
    }
    if (isPromotion) {
      score += PROMOTION_BASE + MVV_LVA_VALUES[move.promotion ?? 'queen'];
    }
    const key = moveKey(move);
    if (!isCapture && !isPromotion) {
      // Killers are validated against this node's legal set: a stale
      // killer from a sibling branch is skipped, never searched.
      if (killerKeys.includes(key) && legalKeys.has(key)) {
        score += KILLER_BASE;
      }
      score += this.history.get(key) ?? 0;
    }
    return score;
  }
}
