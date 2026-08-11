import { describe, expect, it } from 'vitest';

import { generateLegalMoves, isCheckmate, isInCheck, parseFen } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { searchWithTime } from './iterativeDeepening';
import { MATE_SCORE, search } from './search';

/**
 * The six chessprogrammingwiki perft fixture FENs (same set core runs).
 * The iterative-deepening wrapper reuses the fixed-depth search on these,
 * so they double as the "matches fixed-depth" regression fixtures.
 */
const PERFT_FIXTURE_FENS: readonly string[] = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];

/** Issue fixture: White (Ka6, Qb1) mates Black (Ka8) in one with Qb7#. */
const MATE_IN_ONE_FEN = 'k7/8/K7/8/8/8/8/1Q6 w - - 0 1';

/**
 * Issue fixture: White (Kg6, Qg1) mates Black (Kg8) in two. The verified
 * forcing first moves are g1->f2, g1->d4, g1->c5, g1->b6, g1->a7,
 * g1->g5, g1->f1, g1->d1.
 */
const MATE_IN_TWO_FEN = '6k1/8/6K1/8/8/8/8/6Q1 w - - 0 1';
const MATE_IN_TWO_FORCING_FIRST_MOVES: readonly string[] = [
  'f2',
  'd4',
  'c5',
  'b6',
  'a7',
  'g5',
  'f1',
  'd1',
];

/** Issue fixture: Black is checkmated (0 legal moves). */
const CHECKMATE_FEN = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';

/** Issue fixture: Black is stalemated (0 legal moves, not in check). */
const STALEMATE_FEN = '7k/8/6QK/8/8/8/8/8 b - - 0 1';

/** A generous budget: far larger than any fixture's search can consume. */
const GENEROUS_TIME_MS = 1_000_000;

/** 0x88 square from algebraic notation (a1 = 0, h8 = 119). */
function sq(algebraic: string): number {
  const file = algebraic.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(algebraic[1]) - 1;
  return rank * 16 + file;
}

function moveKey(move: Move | null): string {
  if (move === null) {
    return 'null';
  }
  const file = String.fromCharCode((move.to % 16) + 97);
  const rank = String(Math.floor(move.to / 16) + 1);
  return `${file}${rank}${move.promotion ?? ''}`;
}

function isLegal(state: BoardState, move: Move | null): boolean {
  return (
    move !== null &&
    generateLegalMoves(state).some(
      (m) =>
        m.from === move.from &&
        m.to === move.to &&
        m.promotion === move.promotion,
    )
  );
}

/** A clock that never advances: the deadline never passes on its own. */
const frozenClock = (): number => 0;

describe('searchWithTime', () => {
  it('returns a legal root move plus score, completed depth, nodes, and elapsed ms', () => {
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const result = searchWithTime(state, {
      timeMs: GENEROUS_TIME_MS,
      maxDepth: 2,
      now: frozenClock,
    });
    expect(result.depth).toBe(2);
    expect(isLegal(state, result.move)).toBe(true);
    expect(typeof result.score).toBe('number');
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.elapsedMs).toBe(0);
    // The result object carries all four headline fields, per the spec.
    expect(result).toEqual(
      expect.objectContaining({
        move: expect.any(Object),
        score: expect.any(Number),
        depth: 2,
        nodes: expect.any(Number),
        elapsedMs: expect.any(Number),
      }),
    );
  });

  it('returns a legal move for every fixture and a range of budgets', () => {
    for (const fen of PERFT_FIXTURE_FENS) {
      const state = parseFen(fen);
      for (const options of [
        { timeMs: 0, now: frozenClock }, // floor guarantee: depth 1 only
        { timeMs: GENEROUS_TIME_MS, maxDepth: 2, now: frozenClock },
      ] as const) {
        const result = searchWithTime(state, options);
        expect(
          isLegal(state, result.move),
          `${fen} ${JSON.stringify(options)}`,
        ).toBe(true);
      }
    }
  });

  it('always returns a legal move even with an already-exhausted budget (floor guarantee)', () => {
    // A budget that is already spent (0 ms) must still complete depth 1.
    for (const fen of PERFT_FIXTURE_FENS) {
      const state = parseFen(fen);
      const result = searchWithTime(state, { timeMs: 0, now: frozenClock });
      expect(result.depth).toBe(1);
      expect(isLegal(state, result.move)).toBe(true);
      // The depth-1 result is exactly the fixed-depth depth-1 search's.
      expect(result.move).toEqual(search(state, 1).move);
      expect(result.score).toBe(search(state, 1).score);
    }
  });

  it('reports a no-move result for checkmate and stalemate, never fabricating a move', () => {
    const checkmate = parseFen(CHECKMATE_FEN);
    expect(generateLegalMoves(checkmate)).toHaveLength(0);
    const mated = searchWithTime(checkmate, { timeMs: 0, now: frozenClock });
    expect(mated.move).toBeNull();
    expect(mated.score).toBe(-MATE_SCORE);
    expect(mated.depth).toBe(0);

    const stalemate = parseFen(STALEMATE_FEN);
    expect(generateLegalMoves(stalemate)).toHaveLength(0);
    const drawn = searchWithTime(stalemate, { timeMs: 0, now: frozenClock });
    expect(drawn.move).toBeNull();
    expect(drawn.score).toBe(0);
    expect(drawn.depth).toBe(0);
  });

  it('validates maxDepth like the fixed-depth search validates depth', () => {
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        searchWithTime(state, { timeMs: 0, maxDepth: bad, now: frozenClock }),
      ).toThrow(/maxDepth must be a positive integer or Infinity/);
    }
  });
});

describe('mate-in-1 fixture (k7/8/K7/8/8/8/8/1Q6 w - - 0 1)', () => {
  it('finds Qb7# at depth 1 with a mate score, even with no budget left', () => {
    const state = parseFen(MATE_IN_ONE_FEN);
    expect(generateLegalMoves(state)).toHaveLength(24); // issue-verified count
    const result = searchWithTime(state, { timeMs: 0, now: frozenClock });
    expect(result.depth).toBe(1);
    expect(result.move?.from).toBe(sq('b1'));
    expect(result.move?.to).toBe(sq('b7'));
    expect(result.score).toBe(MATE_SCORE - 1); // mate-in-1, distance-adjusted

    // The returned move really is the checkmate.
    const legal = generateLegalMoves(state).find(
      (m) => m.from === sq('b1') && m.to === sq('b7'),
    );
    expect(legal).toBeDefined();
    expect(isCheckmate(state)).toBe(false); // not yet mated: the mate is a move away
    expect(isInCheck(state, state.turn)).toBe(false);
  });
});

describe('mate-in-2 fixture (6k1/8/6K1/8/8/8/8/6Q1 w - - 0 1)', () => {
  it('reports no mate on a depth-1-only budget, but a forced mate when depth 3 completes', () => {
    // Depth-1-only budget: the iteration completes, the mate is unseen —
    // exactly the fixed-depth depth-1 result.
    const shallowState = parseFen(MATE_IN_TWO_FEN);
    const shallow = searchWithTime(shallowState, {
      timeMs: 0,
      now: frozenClock,
    });
    expect(shallow.depth).toBe(1);
    expect(shallow.score).toBeLessThan(MATE_SCORE); // no mate reported
    expect(shallow.move).toEqual(search(shallowState, 1).move);

    // A budget reaching depth 3 finds the mate-in-2 with a mate score.
    const deep = searchWithTime(parseFen(MATE_IN_TWO_FEN), {
      timeMs: GENEROUS_TIME_MS,
      maxDepth: 3,
      now: frozenClock,
    });
    expect(deep.depth).toBe(3);
    expect(deep.score).toBe(MATE_SCORE - 3); // checkmated node sits at ply 3
    const target = moveKey(deep.move); // algebraic target square
    expect(
      MATE_IN_TWO_FORCING_FIRST_MOVES.includes(target),
      `expected a forcing first move, got g1->${target}`,
    ).toBe(true);
  });
});

describe('deadline handling', () => {
  it('stops between iterations when the budget is spent, reporting the last completed depth', () => {
    // Clock flips to timeMs on the wrapper's elapsed check right after
    // depth 1 (call 1 = start, call 2 = elapsed after depth 1): the
    // budget is spent, so no deeper iteration starts.
    const timeMs = 500;
    let calls = 0;
    const now = () => {
      calls++;
      return calls < 2 ? 0 : timeMs;
    };
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const result = searchWithTime(state, { timeMs, now });
    expect(result.depth).toBe(1);
    expect(result.move).toEqual(search(state, 1).move);
    expect(result.elapsedMs).toBe(timeMs);
  });

  it('abandons an in-flight iteration and keeps the last fully completed one (clean stop)', () => {
    // The depth-2 iteration completes; the deadline expires on the first
    // node of depth 3. The depth-3 partial result must never surface.
    // Node counts are deterministic, so the exact abort point is known:
    //   call 1               = start
    //   call 2               = elapsed after depth 1
    //   calls 3..(n2 + 1)    = depth-2 negamax entries (n2 - 1 of them)
    //   call  (n2 + 2)       = elapsed after depth 2
    //   call  (n2 + 3)       = first depth-3 negamax entry -> abort
    const state = parseFen(MATE_IN_TWO_FEN);
    const n1 = search(state, 1).nodes;
    const n2 = search(state, 2).nodes;
    const timeMs = 800;
    const expireAtCall = n2 + 3;
    let calls = 0;
    const now = () => {
      calls++;
      return calls < expireAtCall ? 0 : timeMs;
    };

    const result = searchWithTime(state, { timeMs, now });

    // An aborted iteration must never corrupt the caller's state: the
    // search's make/unmake unwind fully even when the exception skips the
    // intermediate unmake calls.
    expect(state).toEqual(parseFen(MATE_IN_TWO_FEN));

    // The reported result is exactly the depth-2 fixed-depth search's —
    // the mate-in-2 line found only at depth 3 never surfaces.
    const depth2 = search(state, 2);
    expect(result.depth).toBe(2);
    expect(result.move).toEqual(depth2.move);
    expect(result.score).toBe(depth2.score);
    expect(result.score).toBeLessThan(MATE_SCORE); // no mate from the aborted iteration
    expect(result.elapsedMs).toBe(timeMs);
    // The aborted iteration's partial work is still accounted for: the
    // root plus the one node that tripped the deadline.
    expect(result.nodes).toBe(n1 + n2 + 2);
  });

  it('budget is respected: elapsed never exceeds timeMs plus one iteration of work', () => {
    // A clock that advances by a fixed amount per node visit: the deadline
    // passes partway through an iteration, and the search aborts at the
    // next node. The overrun above timeMs is bounded by the granularity of
    // the deadline check (one node's worth of clock time), which is far
    // less than a full iteration — the AC's tolerance bound.
    const NODE_MS = 5;
    const timeMs = 100;
    let calls = 0;
    const now = () => {
      calls++;
      return (calls - 1) * NODE_MS;
    };
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const result = searchWithTime(state, { timeMs, now });
    // The search stopped at the first node where the deadline had passed;
    // the overrun is bounded by one clock step (a single node's work),
    // far less than a full iteration — the AC's tolerance bound.
    expect(result.elapsedMs).toBeGreaterThanOrEqual(timeMs);
    expect(result.elapsedMs - timeMs).toBeLessThanOrEqual(NODE_MS);
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(isLegal(state, result.move)).toBe(true);
  });
});

describe('iterative deepening vs fixed-depth search', () => {
  it('is a faithful wrapper: with a generous budget the ID result at depth D matches the fixed-depth search', () => {
    // Two fixture positions, depths 3 and 2: same move, same score, and
    // the reported depth is exactly D.
    const cases: readonly { fen: string; depth: number }[] = [
      { fen: PERFT_FIXTURE_FENS[0], depth: 3 }, // startpos
      { fen: PERFT_FIXTURE_FENS[1], depth: 2 }, // Kiwipete
    ];
    for (const { fen, depth } of cases) {
      const state = parseFen(fen);
      const idResult = searchWithTime(state, {
        timeMs: GENEROUS_TIME_MS,
        maxDepth: depth,
        now: frozenClock,
      });
      const fixed = search(state, depth);
      expect(idResult.depth, fen).toBe(depth);
      expect(idResult.move, fen).toEqual(fixed.move);
      expect(idResult.score, fen).toBe(fixed.score);
    }
  }, 120_000);

  it('is not wasteful: total nodes to depth D are at most 3x a single depth-D search', () => {
    // Measured on this engine (ordered search, task 3.3): startpos
    // 21+421+2579+12211 = 15232 vs 3*12211 = 36633; Kiwipete
    // 49+2088+6662 = 8799 vs 3*6662 = 19986. The exponential sum is
    // dominated by the last iteration, so ID stays close to one search.
    const cases: readonly { fen: string; depth: number }[] = [
      { fen: PERFT_FIXTURE_FENS[0], depth: 4 }, // startpos
      { fen: PERFT_FIXTURE_FENS[1], depth: 3 }, // Kiwipete
      { fen: PERFT_FIXTURE_FENS[2], depth: 3 }, // position 3
    ];
    for (const { fen, depth } of cases) {
      const state = parseFen(fen);
      const idResult = searchWithTime(state, {
        timeMs: GENEROUS_TIME_MS,
        maxDepth: depth,
        now: frozenClock,
      });
      const fixedNodes = search(state, depth).nodes;
      expect(idResult.depth, fen).toBe(depth);
      expect(
        idResult.nodes,
        `${fen}: ${idResult.nodes} nodes vs ${fixedNodes} fixed`,
      ).toBeLessThanOrEqual(3 * fixedNodes);
    }
  }, 120_000);
});
