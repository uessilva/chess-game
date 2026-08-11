import { describe, expect, it } from 'vitest';

import type { Bound } from './transpositionTable';
import { TranspositionTable } from './transpositionTable';

/** Store a minimal entry under `key` (position hash). */
function store(
  tt: TranspositionTable,
  key: bigint,
  depth = 5,
  score = 100,
  bound: Bound = 'exact',
): void {
  tt.store(key, depth, score, bound, { from: 0, to: 16 });
}

describe('TranspositionTable', () => {
  it('rejects a non-power-of-two capacity', () => {
    for (const bad of [0, -1, 3, 6, 100, 1.5, Number.NaN]) {
      expect(() => new TranspositionTable(bad), `capacity ${bad}`).toThrow(
        /power of two/,
      );
    }
    // Powers of two (including the default) are accepted.
    expect(() => new TranspositionTable()).not.toThrow();
    expect(() => new TranspositionTable(4)).not.toThrow();
    expect(new TranspositionTable(4).capacity).toBe(4);
  });

  it('probes only when the full stored key equals the requested key', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n);
    expect(tt.probe(5n, 5)?.key).toBe(5n);
    expect(tt.probe(5n, 1)?.key).toBe(5n);
    // Same slot (5 & 3 === 1 & 3), different full key → miss.
    expect(tt.probe(1n, 5)).toBeNull();
    // Different slot entirely → miss.
    expect(tt.probe(7n, 5)).toBeNull();
  });

  it('never serves an entry shallower than the requested depth', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n, 3, 100, 'exact');
    expect(tt.probe(5n, 2)).not.toBeNull(); // depth 3 >= requested 2
    expect(tt.probe(5n, 3)).not.toBeNull(); // depth 3 >= requested 3
    expect(tt.probe(5n, 4)).toBeNull(); // depth 3 < requested 4 — a miss
    expect(tt.probe(5n, 5)).toBeNull();
  });

  it('a simulated collision (mismatched stored key) is a miss, never a wrong entry', () => {
    // Keys A and B differ in their full 64-bit value but map to the same
    // slot of a 4-slot table (the index is key & 3).
    const tt = new TranspositionTable(4);
    store(tt, 5n, 4, 999, 'exact');
    // Probe the OTHER key that owns the same slot: full-key verification
    // must reject it even though the slot matches.
    expect(tt.probe(5n, 4)?.score).toBe(999); // A still served to A
    expect(tt.probe(1n, 4)).toBeNull(); // never served to B
    expect(tt.probe(9n, 4)).toBeNull();
  });

  it('applies the depth-preferred replacement policy on slot collisions', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n, 4, 111); // occupant: depth 4
    // Shallower incoming (depth 2) does NOT replace a same-generation deeper entry.
    store(tt, 1n, 2, 222);
    expect(tt.probe(5n, 4)?.score).toBe(111);
    expect(tt.probe(1n, 2)).toBeNull();
    // Deeper or equal incoming replaces it.
    store(tt, 1n, 4, 333);
    expect(tt.probe(1n, 4)?.score).toBe(333);
    expect(tt.probe(5n, 4)).toBeNull();
    // Equal depth also replaces (ties go to the newer entry).
    store(tt, 9n, 4, 444);
    expect(tt.probe(9n, 4)?.score).toBe(444);
  });

  it('evicts stale (older-generation) entries first', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n, 10, 111); // generation 0
    tt.newGeneration(); // generation 1 — the depth-10 entry is now stale
    // A shallow new-generation entry replaces the stale deep one.
    store(tt, 1n, 1, 222);
    expect(tt.probe(1n, 1)?.score).toBe(222);
    expect(tt.probe(5n, 10)).toBeNull();
  });

  it('still serves stale entries from earlier generations (aging only sets replacement priority)', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n, 5, 111); // slot 1
    tt.newGeneration();
    // No collision (different slot): the stale entry keeps serving correct cutoffs.
    store(tt, 2n, 5, 222); // slot 2
    expect(tt.probe(5n, 5)?.score).toBe(111);
    expect(tt.probe(2n, 5)?.score).toBe(222);
  });

  it('stores a move and returns it on probe', () => {
    const tt = new TranspositionTable(4);
    tt.store(5n, 4, 100, 'exact', { from: 4, to: 20, promotion: 'queen' });
    const entry = tt.probe(5n, 4);
    expect(entry?.move).toEqual({ from: 4, to: 20, promotion: 'queen' });
    // A stored entry without a move returns move null (terminal positions).
    tt.store(9n, 4, -1_000_000, 'exact', null);
    expect(tt.probe(9n, 4)?.move).toBeNull();
  });

  it('clear() empties the table and resets the size', () => {
    const tt = new TranspositionTable(4);
    store(tt, 5n); // slot 1
    store(tt, 2n); // slot 2
    expect(tt.size).toBe(2);
    tt.clear();
    expect(tt.size).toBe(0);
    expect(tt.probe(5n, 5)).toBeNull();
    expect(tt.probe(2n, 5)).toBeNull();
  });

  it('tracks the number of occupied slots', () => {
    const tt = new TranspositionTable(4);
    expect(tt.size).toBe(0);
    store(tt, 0n);
    expect(tt.size).toBe(1);
    // Same key re-store keeps one slot.
    store(tt, 0n, 6);
    expect(tt.size).toBe(1);
    // A colliding different key replaces without growing.
    store(tt, 4n, 7);
    expect(tt.size).toBe(1);
    store(tt, 1n);
    store(tt, 2n);
    expect(tt.size).toBe(3);
  });
});

describe('TT entry scores are opaque to the table', () => {
  it('stores and returns any score in engine units unchanged', () => {
    const tt = new TranspositionTable(4);
    for (const score of [0, 42, -73, 1_000_000, -1_000_000, 999_999]) {
      tt.clear();
      tt.store(5n, 3, score, 'exact', null);
      expect(tt.probe(5n, 3)?.score).toBe(score);
    }
  });
});
