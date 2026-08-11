import type { PieceType } from '../core/types';

/**
 * Transposition table (task 3.5): caches alpha-beta search results per
 * position so positions reached through different move orders
 * (transpositions) are searched once instead of repeatedly, and the
 * stored best move feeds the search's move ordering (#18). Standard
 * chess-engine optimization — see the chessprogrammingwiki
 * (Transposition Table).
 *
 * Engine-side, NOT core: `core/` is the future RL environment and must
 * stay search-agnostic, so this module lives in `src/engine/`, runs
 * inside the Web Worker with the rest of the engine, and depends on
 * `src/core` only (pure TypeScript, no DOM, no I/O).
 *
 * ## Keys and collisions
 *
 * The table is keyed by the 64-bit Zobrist hash of the position
 * (`BoardState.zobristKey` — task 3.5's incrementally maintained key,
 * equal to `zobristHash(state)`). The hash is 64 bits, so the residual
 * probability that two DISTINCT positions share a key is 2^-64 per pair
 * (birthday-bound ~2^-32 over a ~2^32-position search, in the same
 * league as the probability of an undetected hardware memory error —
 * every serious engine accepts it). Probe verification makes a wrong
 * score practically impossible: an entry is served ONLY when the stored
 * full 64-bit `key` equals the requested key. A wrong entry could only
 * be served to a position whose full 64-bit identity differs — a
 * position that cannot be constructed accidentally. Table-slot
 * collisions (two keys hashing to the same slot) are therefore never
 * confused for position collisions: they resolve to a miss or a
 * replacement under the policy below, never to a wrong score.
 *
 * ## Replacement policy
 *
 * Fixed capacity, power of two; the slot is `key & mask`. When a new
 * entry collides with a different key in the slot, the policy is
 * **depth-preferred with generation aging**:
 *
 *   1. an entry from an older generation (stale — from a previous
 *      search, marked by `newGeneration()`) is replaced first, even by
 *      a shallower entry;
 *   2. otherwise the new entry replaces the occupant when it was
 *      searched at least as deep (ties go to the newer entry, which
 *      carries a fresher best-move hint).
 *
 * A stale shallow entry poisons move ordering more than a fresh shallow
 * one, which is why age outranks depth. The generation never gates
 * probes — stale entries still serve correct cutoffs (their keys and
 * scores are as valid as ever); aging only sets replacement priority.
 */

/** A move descriptor stored in the table (from/to plus promotion piece). */
export interface TTMove {
  readonly from: number;
  readonly to: number;
  readonly promotion?: PieceType;
}

/** The alpha-beta node type a stored score was proven with. */
export type Bound = 'exact' | 'lower' | 'upper';

/** One cached search result. */
export interface TTEntry {
  /** The full 64-bit position hash — the collision check. */
  readonly key: bigint;
  /** Depth (plies) the position was searched to. */
  readonly depth: number;
  /** The score in engine units (centipawns / mate scores). */
  readonly score: number;
  /** What the score is: exact value, lower bound, or upper bound. */
  readonly bound: Bound;
  /** The best move found (null when none — terminal positions). */
  readonly move: TTMove | null;
  /** The generation this entry was stored under (see replacement policy). */
  readonly age: number;
}

/**
 * Fixed-capacity, power-of-two transposition table. The capacity is the
 * number of slots; each slot holds at most one entry (the replacement
 * policy decides which). The default `1 << 20` slots (~1M entries) is
 * the issue's suggested size; the constructor takes any power of two so
 * tests can use small tables.
 */
export class TranspositionTable {
  private readonly entries: (TTEntry | null)[];
  private readonly mask: number;
  private generation = 0;
  private count = 0;

  constructor(capacity = 1 << 20) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `TranspositionTable: capacity must be a positive power of two, got ${capacity}`,
      );
    }
    if ((capacity & (capacity - 1)) !== 0) {
      throw new Error(
        `TranspositionTable: capacity must be a positive power of two, got ${capacity}`,
      );
    }
    this.entries = new Array<TTEntry | null>(capacity).fill(null);
    this.mask = capacity - 1;
  }

  /** The number of slots (a power of two). */
  get capacity(): number {
    return this.entries.length;
  }

  /** The number of occupied slots. */
  get size(): number {
    return this.count;
  }

  /**
   * Mark the start of a new search: entries stored before the last
   * `newGeneration` are "stale" and are replaced first on collision.
   * Entries remain probeable across generations — aging only sets
   * replacement priority, so iterative deepening keeps reusing the
   * previous iterations' entries.
   */
  newGeneration(): void {
    this.generation++;
  }

  /** Empty the table (e.g. between unrelated searches in tests). */
  clear(): void {
    this.entries.fill(null);
    this.count = 0;
  }

  /**
   * Look up `key`. Returns the stored entry ONLY when the stored full
   * key equals the requested key (the collision check) AND the entry was
   * searched to at least `depth` — a shallower entry is never used for a
   * cutoff (it could only mislead: its bounds were proven for fewer
   * plies). Any other case is a miss and the search proceeds normally.
   */
  probe(key: bigint, depth: number): TTEntry | null {
    const entry = this.entries[this.index(key)];
    if (entry === null || entry.key !== key) {
      return null;
    }
    if (entry.depth < depth) {
      return null;
    }
    return entry;
  }

  /**
   * Store a search result under `key`, applying the depth-preferred with
   * generation-aging replacement policy on a slot collision.
   */
  store(
    key: bigint,
    depth: number,
    score: number,
    bound: Bound,
    move: TTMove | null,
  ): void {
    const index = this.index(key);
    const existing = this.entries[index];
    if (existing !== null && !this.shouldReplace(existing, depth)) {
      return;
    }
    this.entries[index] = {
      key,
      depth,
      score,
      bound,
      move,
      age: this.generation,
    };
    if (existing === null) {
      this.count++;
    }
  }

  /** The slot for a key: the low `log2(capacity)` bits. */
  private index(key: bigint): number {
    return Number(key & BigInt(this.mask));
  }

  /**
   * Replacement policy: replace a different-key occupant when it is from
   * an older generation (stale entries are evicted first) or when the
   * incoming entry was searched at least as deep (ties go to the newer
   * entry, which carries a fresher best-move hint).
   */
  private shouldReplace(existing: TTEntry, incomingDepth: number): boolean {
    return existing.age < this.generation || incomingDepth >= existing.depth;
  }
}
