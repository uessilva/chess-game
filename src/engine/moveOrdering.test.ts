import { describe, expect, it } from 'vitest';

import { generateLegalMoves, parseFen } from '../core';
import type { BoardState } from '../core/state';
import type { Move } from '../core/types';
import { MoveFlags } from '../core/types';
import { materialScore } from './eval';
import { MVV_LVA_VALUES, MoveOrdering, mvvLvaScore } from './moveOrdering';
import { search } from './search';

/**
 * Move-ordering tests (task 3.3): MVV-LVA captures, killer moves, the
 * history heuristic, and the search-level acceptance gates (identical
 * results + strictly fewer nodes than unordered search). Ordering must
 * never change WHICH moves are searched — the permutation assertions here
 * are the guard; `core/`'s perft fixtures are the second, untouched,
 * oracle.
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

/**
 * MVV-LVA fixture (issue scenario 1): White Ka1/Qb2/Rc2/Pf4 attacks Black
 * Kh1/Ne5/Pc7. The knight on e5 is attacked by the queen (b2) and the
 * pawn (f4) — same victim, least valuable attacker must win. The rook on
 * c2 can take the pawn on c7, and there are plenty of quiet moves.
 */
const MVV_LVA_FEN = '8/2p5/8/4n3/5P2/8/1QR5/K6k w - - 0 1';

/** Promotion fixture: White pawn a7 promotes (4 variants) alongside quiet king moves. */
const PROMOTION_FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

/** Issue fixture: White (Ka6, Qb1) mates Black (Ka8) in one with Qb7#. */
const MATE_IN_ONE_FEN = 'k7/8/K7/8/8/8/8/1Q6 w - - 0 1';

/** Issue fixture: White (Kb1, Qd4) forces mate in two starting with Kc2. */
const MATE_IN_TWO_FEN = '8/8/8/8/3Q4/k7/8/1K6 w - - 0 1';

/** 0x88 square from algebraic notation (a1 = 0, h8 = 119). */
function sq(algebraic: string): number {
  const file = algebraic.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(algebraic[1]) - 1;
  return rank * 16 + file;
}

/** True when the two moves are the same from/to/promotion. */
function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

/**
 * Sorted set identity of a move list — the permutation guard. Equal for
 * two lists iff they contain exactly the same moves (regardless of
 * order), so it fails on any dropped, duplicated, or invented move.
 */
function moveSetKey(moves: Move[]): string {
  return moves
    .map((m) => `${m.from}:${m.to}:${m.promotion ?? '-'}`)
    .sort()
    .join('|');
}

describe('MVV-LVA capture ordering (scenario 1)', () => {
  const state = parseFen(MVV_LVA_FEN);
  const moves = generateLegalMoves(state);

  const pawnTakesKnight = moves.find(
    (m) => m.from === sq('f4') && m.to === sq('e5'),
  );
  const queenTakesKnight = moves.find(
    (m) => m.from === sq('b2') && m.to === sq('e5'),
  );
  const rookTakesPawn = moves.find(
    (m) => m.from === sq('c2') && m.to === sq('c7'),
  );

  it('has the three expected captures in the fixture', () => {
    expect(pawnTakesKnight).toBeDefined();
    expect(queenTakesKnight).toBeDefined();
    expect(rookTakesPawn).toBeDefined();
  });

  it('scores the same-victim captures by attacker value: pawn over queen', () => {
    expect(mvvLvaScore(state, pawnTakesKnight!)).toBeGreaterThan(
      mvvLvaScore(state, queenTakesKnight!),
    );
    // Victim dominates: a knight capture outranks a pawn capture even
    // with the least valuable attacker.
    expect(mvvLvaScore(state, pawnTakesKnight!)).toBe(
      MVV_LVA_VALUES.knight * 1000 - MVV_LVA_VALUES.pawn,
    );
    expect(mvvLvaScore(state, rookTakesPawn!)).toBe(
      MVV_LVA_VALUES.pawn * 1000 - MVV_LVA_VALUES.rook,
    );
    expect(mvvLvaScore(state, pawnTakesKnight!)).toBeGreaterThan(
      mvvLvaScore(state, rookTakesPawn!),
    );
  });

  it('tries the pawn capture before the queen capture (same victim, least valuable attacker first)', () => {
    const ordered = new MoveOrdering(4).orderMoves(state, moves, 1);
    expect(ordered.indexOf(pawnTakesKnight!)).toBeLessThan(
      ordered.indexOf(queenTakesKnight!),
    );
    // Higher victim first: both knight captures before rook-takes-pawn.
    expect(ordered.indexOf(queenTakesKnight!)).toBeLessThan(
      ordered.indexOf(rookTakesPawn!),
    );
  });

  it('tries every capture before any quiet move', () => {
    const ordered = new MoveOrdering(4).orderMoves(state, moves, 1);
    const captures = ordered.filter((m) => (m.flags & MoveFlags.CAPTURE) !== 0);
    expect(captures.length).toBeGreaterThan(0);
    const firstQuiet = ordered.findIndex(
      (m) => (m.flags & MoveFlags.CAPTURE) === 0,
    );
    for (const capture of captures) {
      expect(
        ordered.indexOf(capture),
        `${capture.from}->${capture.to}`,
      ).toBeLessThan(firstQuiet);
    }
  });
});

describe('promotion ordering (criterion: promotions ahead of quiet moves)', () => {
  it('orders every promotion before the first quiet move', () => {
    const ordering = new MoveOrdering(4);
    const state = parseFen(PROMOTION_FEN);
    const moves = generateLegalMoves(state);
    const promotions = moves.filter(
      (m) => (m.flags & MoveFlags.PROMOTION) !== 0,
    );
    const quiets = moves.filter((m) => (m.flags & MoveFlags.PROMOTION) === 0);
    expect(promotions.length).toBeGreaterThan(0);
    expect(quiets.length).toBeGreaterThan(0);

    const ordered = ordering.orderMoves(state, moves, 0);
    const firstQuiet = ordered.findIndex(
      (m) => (m.flags & MoveFlags.PROMOTION) === 0,
    );
    expect(firstQuiet).toBe(promotions.length);
    for (const promotion of promotions) {
      expect(
        ordered.indexOf(promotion),
        `promotion to ${promotion.promotion}`,
      ).toBeLessThan(firstQuiet);
    }
  });

  it('scores an en-passant capture by its pawn victim (beside the target square)', () => {
    const state = parseFen('8/8/8/3pP3/8/8/8/4K2k w - d6 0 1');
    const ep = generateLegalMoves(state).find(
      (m) =>
        m.from === sq('e5') &&
        m.to === sq('d6') &&
        (m.flags & MoveFlags.EN_PASSANT) !== 0,
    );
    expect(ep).toBeDefined();
    expect(mvvLvaScore(state, ep!)).toBe(
      MVV_LVA_VALUES.pawn * 1000 - MVV_LVA_VALUES.pawn,
    );
  });
});

describe('killer moves (scenario 2)', () => {
  it('tries a recorded killer right after captures at its ply, before other quiet moves', () => {
    const ordering = new MoveOrdering(8);
    const state = parseFen(MVV_LVA_FEN);
    const moves = generateLegalMoves(state);
    // A quiet move (Rc2-c4) recorded as the killer at ply 1.
    const quiet = moves.find((m) => m.from === sq('c2') && m.to === sq('c4'));
    expect(quiet).toBeDefined();
    ordering.recordKiller(quiet!, 1);

    const ordered = ordering.orderMoves(state, moves, 1);
    const idx = ordered.findIndex((m) => sameMove(m, quiet!));
    expect(idx).toBeGreaterThanOrEqual(0);
    // Everything before the killer is a capture...
    expect(
      ordered.slice(0, idx).every((m) => (m.flags & MoveFlags.CAPTURE) !== 0),
    ).toBe(true);
    // ...and it is the very first quiet move.
    const firstQuiet = ordered.findIndex(
      (m) => (m.flags & MoveFlags.CAPTURE) === 0,
    );
    expect(ordered[firstQuiet]).toEqual(quiet);
  });

  it('does not promote the killer when ordered at a different ply', () => {
    const ordering = new MoveOrdering(8);
    const state = parseFen(MVV_LVA_FEN);
    const moves = generateLegalMoves(state);
    const quiet = moves.find((m) => m.from === sq('c2') && m.to === sq('c4'))!;
    ordering.recordKiller(quiet, 1);
    const ordered = ordering.orderMoves(state, moves, 2);
    // The move is still legal and present, but without the killer bonus
    // it sits after the captures and after the ply-1 killer ordering.
    expect(ordered.includes(quiet)).toBe(true);
    const idx = ordered.findIndex((m) => sameMove(m, quiet));
    expect(idx).toBeGreaterThanOrEqual(
      ordered.filter((m) => (m.flags & MoveFlags.CAPTURE) !== 0).length,
    );
  });

  it('skips a stale killer that is not legal in the current position', () => {
    const ordering = new MoveOrdering(8);
    // Ng1-f3 was a killer at ply 2 in an earlier branch...
    const start = parseFen(PERFT_FIXTURE_FENS[0]);
    const knightMove = generateLegalMoves(start).find(
      (m) => m.from === sq('g1') && m.to === sq('f3'),
    )!;
    expect(knightMove).toBeDefined();
    ordering.recordKiller(knightMove, 2);

    // ...but this sibling position at ply 2 has no knight on g1, so the
    // killer is illegal here: it must be skipped, never searched.
    const sibling = parseFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQK2R w KQkq - 0 1',
    );
    const legal = generateLegalMoves(sibling);
    const ordered = ordering.orderMoves(sibling, legal, 2);
    // Still a pure permutation (nothing dropped/invented)...
    expect(moveSetKey(ordered)).toBe(moveSetKey(legal));
    // ...and the stale killer is not among the searched moves.
    expect(ordered.some((m) => sameMove(m, knightMove))).toBe(false);
  });

  it('ignores out-of-range plies (defensive guard, caller bug)', () => {
    const ordering = new MoveOrdering(2);
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const moves = generateLegalMoves(state);
    const g1f3 = moves.find((m) => m.from === sq('g1') && m.to === sq('f3'))!;
    // Recording at a ply beyond maxDepth must not throw or corrupt...
    expect(() => ordering.recordKiller(g1f3, 99)).not.toThrow();
    // ...and ordering at an out-of-range ply stays a pure permutation.
    const ordered = ordering.orderMoves(state, moves, 99);
    expect(moveSetKey(ordered)).toBe(moveSetKey(moves));
  });
});

describe('history heuristic (scenario 3)', () => {
  it('orders quiet moves by descending history score, accumulating repeated cutoffs', () => {
    const ordering = new MoveOrdering(8);
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const moves = generateLegalMoves(state);
    const g1f3 = moves.find((m) => m.from === sq('g1') && m.to === sq('f3'))!;
    const a2a3 = moves.find((m) => m.from === sq('a2') && m.to === sq('a3'))!;
    // g1->f3 fails high across repeated sibling branches (depth 3 twice
    // -> +18); a2->a3 once (depth 2 -> +4).
    ordering.recordHistory(g1f3, 3);
    ordering.recordHistory(g1f3, 3);
    ordering.recordHistory(a2a3, 2);
    const ordered = ordering.orderMoves(state, moves, 0);
    // Startpos at ply 0 has no captures/promotions: quiets only, so the
    // highest-history move is first and beats the lower-history one.
    expect(ordered[0]).toEqual(g1f3);
    expect(ordered.indexOf(g1f3)).toBeLessThan(ordered.indexOf(a2a3));
  });

  it('resets between searches: a fresh MoveOrdering has no killers or history', () => {
    const seeded = new MoveOrdering(8);
    const fresh = new MoveOrdering(8);
    const state = parseFen(PERFT_FIXTURE_FENS[0]);
    const moves = generateLegalMoves(state);
    const g1f3 = moves.find((m) => m.from === sq('g1') && m.to === sq('f3'))!;
    seeded.recordKiller(g1f3, 1);
    seeded.recordHistory(g1f3, 4);
    // A fresh ordering has no recorded state: g1->f3 keeps its natural
    // (generation) position instead of being pulled to the front.
    const ordered = fresh.orderMoves(state, moves, 1);
    expect(ordered[0]).not.toEqual(g1f3);
  });
});

describe('ordering is a pure permutation (criterion: no dropped/duplicated/invented moves)', () => {
  it('permutes the legal move set across the perft fixtures and plies', () => {
    const ordering = new MoveOrdering(4);
    for (const fen of PERFT_FIXTURE_FENS) {
      const state = parseFen(fen);
      const moves = generateLegalMoves(state);
      for (const ply of [0, 1, 2, 3]) {
        const ordered = ordering.orderMoves(state, moves, ply);
        expect(ordered).toHaveLength(moves.length);
        expect(moveSetKey(ordered), `${fen} ply ${ply}`).toBe(
          moveSetKey(moves),
        );
      }
    }
  });

  it('stays a pure permutation even when the ordering state holds stale entries', () => {
    const ordering = new MoveOrdering(4);
    const start = parseFen(PERFT_FIXTURE_FENS[0]);
    const startMoves = generateLegalMoves(start);
    for (const move of startMoves.slice(0, 3)) {
      ordering.recordKiller(move, 1);
      ordering.recordHistory(move, 3);
    }
    for (const fen of PERFT_FIXTURE_FENS.slice(1)) {
      const state = parseFen(fen);
      const moves = generateLegalMoves(state);
      const ordered = ordering.orderMoves(state, moves, 1);
      expect(moveSetKey(ordered), fen).toBe(moveSetKey(moves));
    }
  });
});

describe('search with ordering vs unordered (scenario 4: changes speed, not results)', () => {
  /** Deterministic stub evaluation (material only, side-to-move relative). */
  const stubEvaluate = (state: BoardState): number =>
    state.turn === 'white' ? materialScore(state) : -materialScore(state);

  /**
   * The #17 test suite: mate-in-1, mate-in-2, and Kiwipete. Depths were
   * picked so ordering reduces the node count at every fixture (measured
   * at implementation time: d5 on the forced-mate lines, d3 on Kiwipete —
   * Kiwipete d4 shows the same 70% reduction but is too slow for the
   * default gate; its exact numbers are reported in the PR body).
   */
  const SUITE: readonly { name: string; fen: string; depth: number }[] = [
    { name: 'mate-in-1', fen: MATE_IN_ONE_FEN, depth: 5 },
    { name: 'mate-in-2', fen: MATE_IN_TWO_FEN, depth: 5 },
    { name: 'Kiwipete', fen: PERFT_FIXTURE_FENS[1], depth: 3 },
  ];

  it('returns identical best move and score with and without ordering', () => {
    for (const { name, fen, depth } of SUITE) {
      const state = parseFen(fen);
      const ordered = search(state, depth, stubEvaluate, { ordered: true });
      const unordered = search(state, depth, stubEvaluate, {
        ordered: false,
      });
      expect(ordered.move, `${name} move`).toEqual(unordered.move);
      expect(ordered.score, `${name} score`).toBe(unordered.score);
    }
  }, 120_000);

  it('visits strictly fewer nodes with ordering enabled at fixed depth', () => {
    for (const { name, fen, depth } of SUITE) {
      const state = parseFen(fen);
      const ordered = search(state, depth, stubEvaluate, { ordered: true });
      const unordered = search(state, depth, stubEvaluate, {
        ordered: false,
      });
      expect(ordered.nodes, `${name} nodes`).toBeLessThan(unordered.nodes);
    }
  }, 120_000);

  it('uses a fresh MoveOrdering per search, so ordering state never leaks between searches', () => {
    const state = parseFen(PERFT_FIXTURE_FENS[1]);
    const a = search(state, 3, stubEvaluate, { ordered: true });
    const b = search(state, 3, stubEvaluate, { ordered: true });
    expect(a).toEqual(b);
  }, 120_000);
});
