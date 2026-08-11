import { describe, expect, it } from 'vitest';

import { parseFen } from '../core';
import { searchWithTime } from './iterativeDeepening';
import {
  MATE_SCORE,
  scoreFromTT,
  scoreToTT,
  search,
  ttCutoffScore,
} from './search';
import { TranspositionTable } from './transpositionTable';

/**
 * Task 3.5 transposition-table search tests (#20): the TT must reduce
 * nodes at fixed depth, never change the engine's answer (same best move
 * and score as the no-TT search at equal depth), honor depth and bounds
 * on probe cutoffs, treat key collisions as misses, and keep mate scores
 * measured from the root.
 */

/** The six chessprogrammingwiki perft fixture FENs (same set core runs). */
const PERFT_FIXTURE_FENS: readonly string[] = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];

/** Issue fixture: White (Ka6, Qb1) mates Black (Ka8) in one with Qb7#. */
const MATE_IN_ONE_FEN = 'k7/8/K7/8/8/8/8/1Q6 w - - 0 1';

/** Issue fixture: White (Kb1, Qd4) forces mate in two starting with Kc2. */
const MATE_IN_TWO_FEN = '8/8/8/8/3Q4/k7/8/1K6 w - - 0 1';

const START_FEN = PERFT_FIXTURE_FENS[0];
const POS3_FEN = PERFT_FIXTURE_FENS[2];

/** The position after 1. e4 (the first child probed in a startpos search). */
const AFTER_E4_FEN =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

/** A fresh table per run: the "TT disabled/cleared" baseline. */
function freshTT(): TranspositionTable {
  return new TranspositionTable();
}

describe('node reduction at fixed depth', () => {
  // Depth 6 from startpos reduces 434,241 → 291,079 nodes (33.0%) when
  // measured outside coverage instrumentation; the committed guard runs
  // depth 5 (fast enough under the coverage gate) and position 3 at
  // depth 6 — both show the same monotonic reduction.
  it('startpos depth 5: strictly fewer nodes with the TT enabled, same answer', () => {
    const noTT = search(parseFen(START_FEN), 5);
    const withTT = search(parseFen(START_FEN), 5, undefined, { tt: freshTT() });
    expect(withTT.nodes).toBeLessThan(noTT.nodes);
    expect(withTT.move).toEqual(noTT.move);
    expect(withTT.score).toBe(noTT.score);
  }, 120_000);

  it('position 3 depth 6: strictly fewer nodes with the TT enabled, same answer', () => {
    const noTT = search(parseFen(POS3_FEN), 6);
    const withTT = search(parseFen(POS3_FEN), 6, undefined, { tt: freshTT() });
    expect(withTT.nodes).toBeLessThan(noTT.nodes);
    expect(withTT.move).toEqual(noTT.move);
    expect(withTT.score).toBe(noTT.score);
  }, 120_000);
});

describe('the TT never changes the engine answer', () => {
  it('matches the no-TT search on move and score across the six fixtures at depth 2', () => {
    for (const fen of PERFT_FIXTURE_FENS) {
      const base = search(parseFen(fen), 2);
      const withTT = search(parseFen(fen), 2, undefined, { tt: freshTT() });
      expect(withTT.move, fen).toEqual(base.move);
      expect(withTT.score, fen).toBe(base.score);
    }
    // Explicit timeout: this suite is fast in isolation (~2s) but the
    // depth-2 search over six fixtures tripped the 5s default under
    // parallel coverage load (a pre-existing flake, reproduced on main).
  }, 60_000);

  it('matches the no-TT search on move and score at depth 3 (spot checks)', () => {
    for (const fen of [START_FEN, POS3_FEN, PERFT_FIXTURE_FENS[3]]) {
      const base = search(parseFen(fen), 3);
      const withTT = search(parseFen(fen), 3, undefined, { tt: freshTT() });
      expect(withTT.move, fen).toEqual(base.move);
      expect(withTT.score, fen).toBe(base.score);
    }
  }, 300_000);

  it('is deterministic on a warmed table (same move and score on the second run)', () => {
    const tt = freshTT();
    const state = parseFen(PERFT_FIXTURE_FENS[1]); // Kiwipete
    const first = search(state, 2, undefined, { tt });
    const second = search(state, 2, undefined, { tt });
    expect(second.move).toEqual(first.move);
    expect(second.score).toBe(first.score);
  }, 60_000);

  it('leaves the state untouched with the TT enabled', () => {
    const fen = PERFT_FIXTURE_FENS[1];
    const state = parseFen(fen);
    search(state, 2, undefined, { tt: freshTT() });
    expect(state).toEqual(parseFen(fen));
  }, 60_000);

  it('searchWithTime keeps the same move and score with the TT enabled', () => {
    const withoutTT = searchWithTime(parseFen(START_FEN), {
      timeMs: 1_000_000,
      maxDepth: 3,
      now: () => 0,
    });
    const withTT = searchWithTime(parseFen(START_FEN), {
      timeMs: 1_000_000,
      maxDepth: 3,
      now: () => 0,
      tt: freshTT(),
    });
    expect(withTT.depth).toBe(withoutTT.depth);
    expect(withTT.move).toEqual(withoutTT.move);
    expect(withTT.score).toBe(withoutTT.score);
  }, 120_000);
});

describe('a transposition is searched once, not twice', () => {
  it('reuses the stored subtree when the same position is searched again', () => {
    // 1. e4 e5 2. Nf3 and 1. Nf3 e5 2. e4 reach the SAME position (same
    // 64-bit key — verified in the core invariant suite). Searching one
    // fills the table; searching the other must probe those entries and
    // skip the re-expansion — fewer nodes than a cold search of the same
    // position, with the same answer.
    const transposed = parseFen(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    );
    const tt = freshTT();
    search(transposed, 4, undefined, { tt });
    const warm = search(transposed, 4, undefined, { tt });
    const cold = search(transposed, 4, undefined, { tt: freshTT() });
    expect(warm.move).toEqual(cold.move);
    expect(warm.score).toBe(cold.score);
    expect(warm.nodes).toBeLessThan(cold.nodes);
  }, 120_000);
});

describe('shallow entries never cause a wrong cutoff', () => {
  it('ignores an entry shallower than the requested depth and re-searches', () => {
    // Sabotage: an EXACT entry with a wildly wrong score for the after-1.e4
    // position, stored at depth 3. A depth-5 search reaches that position
    // at requested depth 4, so the probe must miss and the subtree must be
    // re-searched — the wrong score must never surface.
    const tt = freshTT();
    const afterE4 = parseFen(AFTER_E4_FEN);
    tt.store(afterE4.zobristKey, 3, 999_999, 'exact', null);
    const base = search(parseFen(START_FEN), 5);
    const sabotaged = search(parseFen(START_FEN), 5, undefined, { tt });
    expect(sabotaged.move).toEqual(base.move);
    expect(sabotaged.score).toBe(base.score);
  }, 120_000);

  it('an entry with sufficient depth is used, but only when its bound matches', () => {
    // Positive control: the same wrong-score entry stored at depth 100 IS
    // deep enough, but it is an UPPER bound — a cutoff requires
    // stored <= alpha, and a huge stored score fails that at any node.
    // The bound gate (not the depth gate) must reject it.
    const tt = freshTT();
    const afterE4 = parseFen(AFTER_E4_FEN);
    tt.store(afterE4.zobristKey, 100, 999_999, 'upper', null);
    const base = search(parseFen(START_FEN), 4);
    const sabotaged = search(parseFen(START_FEN), 4, undefined, { tt });
    expect(sabotaged.move).toEqual(base.move);
    expect(sabotaged.score).toBe(base.score);
  }, 60_000);
});

describe('TT bound logic', () => {
  it('exact entries always cut and return the stored score', () => {
    expect(ttCutoffScore('exact', 100, 0, 200)).toEqual({
      cutoff: true,
      score: 100,
    });
  });

  it('lower entries fail high only when the stored score >= beta — never fail low', () => {
    expect(ttCutoffScore('lower', 150, 0, 100)).toEqual({
      cutoff: true,
      score: 150,
    });
    expect(ttCutoffScore('lower', 50, 0, 100)).toEqual({
      cutoff: false,
      score: 50,
    });
    // Even an absurdly negative lower-bound score must not fail low:
    // the bound only proves the true score is AT LEAST the stored value.
    expect(ttCutoffScore('lower', -999_999, 0, 100)).toEqual({
      cutoff: false,
      score: -999_999,
    });
  });

  it('upper entries fail low only when the stored score <= alpha — never fail high', () => {
    expect(ttCutoffScore('upper', -50, 0, 100)).toEqual({
      cutoff: true,
      score: -50,
    });
    expect(ttCutoffScore('upper', 150, 0, 100)).toEqual({
      cutoff: false,
      score: 150,
    });
    // Even an absurdly positive upper-bound score must not fail high:
    // the bound only proves the true score is AT MOST the stored value.
    expect(ttCutoffScore('upper', 999_999, 0, 100)).toEqual({
      cutoff: false,
      score: 999_999,
    });
  });
});

describe('a simulated key collision is a miss, never a wrong score', () => {
  it('an entry under a different full key sharing the slot is never served', () => {
    const tt = freshTT(); // capacity 1<<20: index = key & (2^20 - 1)
    const afterE4 = parseFen(AFTER_E4_FEN);
    // Same slot as afterE4 (bits below 2^20 identical), different full
    // key — the kind of collision only a 2^-64 key clash could cause for
    // real. Stored with a wrong score and depth enough to be usable IF the
    // key matched; full-key verification must reject it.
    const collidingKey = afterE4.zobristKey ^ (1n << 21n);
    tt.store(collidingKey, 100, 999_999, 'exact', null);
    const base = search(parseFen(START_FEN), 4);
    const withTT = search(parseFen(START_FEN), 4, undefined, { tt });
    expect(withTT.move).toEqual(base.move);
    expect(withTT.score).toBe(base.score);
  }, 60_000);
});

describe('mate scores stay measured from the root', () => {
  it('scoreToTT/scoreFromTT round-trip mate scores at any ply', () => {
    // A mated node at ply p scores -(MATE_SCORE - p); table coordinates
    // rewrite it to -MATE_SCORE (mated at distance 0), independent of p.
    expect(scoreToTT(-(MATE_SCORE - 3), 3)).toBe(-MATE_SCORE);
    expect(scoreToTT(-(MATE_SCORE - 7), 7)).toBe(-MATE_SCORE);
    expect(scoreFromTT(-MATE_SCORE, 3)).toBe(-(MATE_SCORE - 3));
    expect(scoreFromTT(-MATE_SCORE, 7)).toBe(-(MATE_SCORE - 7));
    // A mate-in-1 position reached at any ply stores MATE_SCORE - 1.
    expect(scoreToTT(MATE_SCORE - 2, 1)).toBe(MATE_SCORE - 1);
    expect(scoreToTT(MATE_SCORE - 4, 3)).toBe(MATE_SCORE - 1);
    expect(scoreFromTT(MATE_SCORE - 1, 1)).toBe(MATE_SCORE - 2);
    expect(scoreFromTT(MATE_SCORE - 1, 3)).toBe(MATE_SCORE - 4);
    // Round-trip over the whole mate band.
    for (const ply of [0, 1, 3, 7]) {
      for (const score of [
        MATE_SCORE - 1,
        MATE_SCORE - 50,
        MATE_SCORE - 511,
        -MATE_SCORE + 1,
        -MATE_SCORE + 50,
      ]) {
        expect(scoreFromTT(scoreToTT(score, ply), ply), `ply ${ply}`).toBe(
          score,
        );
      }
    }
  });

  it('non-mate centipawn scores pass through the conversion unchanged', () => {
    for (const score of [-9_999, -100, 0, 50, 9_999]) {
      expect(scoreToTT(score, 5)).toBe(score);
      expect(scoreFromTT(score, 5)).toBe(score);
    }
  });

  it('reports the same mate distance with the TT enabled (mate-in-1, depths 1-5)', () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      const base = search(parseFen(MATE_IN_ONE_FEN), depth);
      const withTT = search(parseFen(MATE_IN_ONE_FEN), depth, undefined, {
        tt: freshTT(),
      });
      expect(withTT.move, `depth ${depth}`).toEqual(base.move);
      expect(withTT.score, `depth ${depth}`).toBe(base.score);
      expect(base.score, `depth ${depth}`).toBe(MATE_SCORE - 1);
    }
  });

  it('reports the same mate distance with the TT enabled (mate-in-2, depths 3-4)', () => {
    for (const depth of [3, 4]) {
      const base = search(parseFen(MATE_IN_TWO_FEN), depth);
      const withTT = search(parseFen(MATE_IN_TWO_FEN), depth, undefined, {
        tt: freshTT(),
      });
      expect(withTT.move, `depth ${depth}`).toEqual(base.move);
      expect(withTT.score, `depth ${depth}`).toBe(base.score);
      expect(base.score, `depth ${depth}`).toBe(MATE_SCORE - 3);
    }
  });
});
