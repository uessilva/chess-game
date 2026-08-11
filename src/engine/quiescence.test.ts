import { describe, expect, it } from 'vitest';

import {
  fileOf,
  generateLegalMoves,
  isCheckmate,
  isInCheck,
  makeMove,
  parseFen,
  unmakeMove,
} from '../core';
import type { BoardState } from '../core/state';
import type { Move, PieceType } from '../core/types';
import { MoveFlags } from '../core/types';
import { evaluate } from './eval';
import { searchWithTime } from './iterativeDeepening';
import { quiescenceSearch } from './quiescence';
import { MATE_SCORE, scoreFromTT, search, SearchTimeoutError } from './search';
import { TranspositionTable } from './transpositionTable';

/**
 * Task 3.6 quiescence search tests (#21): every scenario in the issue has
 * a unit test here. Qsearch extends the fixed-depth search past its
 * horizon by searching only forcing moves — captures and promotions —
 * until the position is quiet, using the stand-pat cutoff to keep the
 * tree bounded. All fixture FENs are from the issue and are untouched.
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

const START_FEN = PERFT_FIXTURE_FENS[0];
const KIWIPETE_FEN = PERFT_FIXTURE_FENS[1];

/** Scenario 1: White's Qb1 is attacked by Rb8; Qxb8 hangs it to Rf8xb8. */
const HANGING_QUEEN_FEN = '1r3rk1/8/8/8/8/8/8/1Q4K1 w - - 0 1';

/** Scenario 2: White is in check from Qe2+; Kxe2 and Rxe2 capture it. */
const IN_CHECK_FEN = '4k3/8/8/8/8/8/2R1q3/4K3 w - - 0 1';

/** Scenario 3: White pawn h7, knight g6 covering h8, Black king g8. */
const PROMOTION_FEN = '6k1/7P/6N1/8/8/8/8/6K1 w - - 0 1';

/** Scenario 4: White can play Qxg7# (capture that mates). */
const MATE_CAPTURE_FEN = '6k1/4Q1r1/7P/8/8/8/8/6K1 w - - 0 1';

/** Scenario 5: White pawn e5, Black pawn d5, en passant target d6. */
const EN_PASSANT_FEN = '6k1/8/8/3pP3/8/8/8/6K1 w - d6 0 1';

/** Scenario 6: White is up a queen (stand-pat beta cutoff). */
const UP_A_QUEEN_FEN = '6k1/8/8/8/8/8/8/3Q2K1 w - - 0 1';

/** Scenario 9: no captures available, neither side in check. */
const QUIET_FEN = '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1';

/** 0x88 square from algebraic notation (a1 = 0, h8 = 119). */
function sq(algebraic: string): number {
  const file = algebraic.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(algebraic[1]) - 1;
  return rank * 16 + file;
}

function sameMove(a: Move, b: Move | null): boolean {
  return (
    b !== null &&
    a.from === b.from &&
    a.to === b.to &&
    a.promotion === b.promotion
  );
}

describe('quiescenceSearch API surface', () => {
  it('returns a negamax-compatible score for the side to move, plus nodes and the abort flag', () => {
    const state = parseFen(QUIET_FEN);
    const result = quiescenceSearch(state, -Infinity, Infinity);
    expect(result.score).toBe(0);
    expect(result.nodes).toBe(1);
    expect(result.aborted).toBe(false);
  });

  it('leaves the state untouched (makeMove/unmakeMove fully restores it)', () => {
    const state = parseFen(MATE_CAPTURE_FEN);
    quiescenceSearch(state, -Infinity, Infinity);
    expect(state).toEqual(parseFen(MATE_CAPTURE_FEN));
  });

  it('validates maxPly like the search validates depth', () => {
    const state = parseFen(QUIET_FEN);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        quiescenceSearch(state, -Infinity, Infinity, { maxPly: bad }),
      ).toThrow(/maxPly must be a positive integer/);
    }
  });
});

describe('Scenario 6: stand-pat beta cutoff', () => {
  it('a non-check node whose static eval >= beta returns beta immediately, expanding zero capture nodes', () => {
    const state = parseFen(UP_A_QUEEN_FEN);
    const result = quiescenceSearch(state, -Infinity, 8);
    expect(result.score).toBe(8); // exactly beta, not the real ~+930 eval
    expect(result.nodes).toBe(1); // the root only — no capture expanded
  });
});

describe('Scenario 9: quiet positions are unchanged', () => {
  it('returns the static evaluation unchanged and expands zero capture nodes', () => {
    const state = parseFen(QUIET_FEN);
    expect(
      generateLegalMoves(state).every(
        (m) => (m.flags & MoveFlags.CAPTURE) === 0,
      ),
    ).toBe(true);
    const result = quiescenceSearch(state, -Infinity, Infinity);
    expect(result.score).toBe(evaluate(state));
    expect(result.nodes).toBe(1);
  });
});

describe('Scenario 2: in-check nodes never stand pat', () => {
  it('searches the evasions and returns a winning score (White wins the queen)', () => {
    const state = parseFen(IN_CHECK_FEN);
    const result = quiescenceSearch(state, -Infinity, Infinity);
    // Kxe2 / Rxe2 both capture the checking queen; Rxe2+ even gives check
    // on the e-file, so the node count reflects the searched evasions.
    expect(result.score).toBe(500); // White ends a rook up
    expect(result.nodes).toBe(4);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe('Scenario 4: a capture that mates is scored as mate', () => {
  it('Qxg7 is searched as a capture, the opponent in-check-no-moves node is checkmate, and a mate score is returned', () => {
    const state = parseFen(MATE_CAPTURE_FEN);
    const result = quiescenceSearch(state, -Infinity, Infinity);
    expect(result.score).toBe(MATE_SCORE - 1); // mated node sits at qsearch ply 1

    // The capture really is mate: Qxg7#.
    const qxg7 = generateLegalMoves(state).find(
      (m) => m.from === sq('e7') && m.to === sq('g7'),
    );
    expect(qxg7).toBeDefined();
    makeMove(state, qxg7!);
    expect(isCheckmate(state)).toBe(true);
    unmakeMove(state);
  });
});

describe('Scenario 5: en passant is a qsearch capture', () => {
  it("exd6 is searched and White's score reflects winning the d5 pawn", () => {
    const state = parseFen(EN_PASSANT_FEN);
    const standPat = evaluate(state);
    const result = quiescenceSearch(state, -Infinity, Infinity);
    // The ep capture exd6 (flags CAPTURE|EN_PASSANT) is the only tactical
    // move; it wins the d5 pawn, so the qsearch value exceeds the stand-pat.
    expect(result.nodes).toBe(2);
    expect(result.score).toBeGreaterThan(standPat);
    expect(result.score).toBe(130); // standPat +5 → +130 after exd6
  });
});

describe('Scenario 3: promotion at the horizon, with the correct piece', () => {
  it('searches the promotion and chooses h8=Q over h8=R', () => {
    const state = parseFen(PROMOTION_FEN);

    const lineScore = (promotion: PieceType): number => {
      const move = generateLegalMoves(state).find(
        (m) =>
          m.from === sq('h7') && m.to === sq('h8') && m.promotion === promotion,
      );
      expect(move, `h8=${promotion}`).toBeDefined();
      makeMove(state, move!);
      const child = quiescenceSearch(state, -Infinity, Infinity);
      unmakeMove(state);
      return -child.score; // white's perspective
    };

    const queenLine = lineScore('queen');
    const rookLine = lineScore('rook');
    expect(queenLine).toBeGreaterThan(rookLine); // h8=Q, not h8=R

    const root = quiescenceSearch(state, -Infinity, Infinity);
    expect(root.score).toBe(queenLine); // the root picks the queen line

    // The issue's parenthetical says h8=Q is mate, but Kf7 escapes (the
    // knight covers f8/h8, the queen covers g7/h7 — f7 is untouched), so
    // the score is the material-winning +1230 rather than a mate score.
    expect(root.score).toBe(1230);
    const h8q = generateLegalMoves(state).find(
      (m) =>
        m.from === sq('h7') && m.to === sq('h8') && m.promotion === 'queen',
    );
    expect(h8q).toBeDefined();
    makeMove(state, h8q!);
    expect(generateLegalMoves(state).length).toBeGreaterThan(0); // not mate
    expect(isInCheck(state, state.turn)).toBe(true); // but in check
    unmakeMove(state);
  });
});

describe('Scenario 1: recapture at the horizon is resolved (hanging-piece regression)', () => {
  it('WITHOUT qsearch the depth-1 search blunders: plays Qxb8, scored as winning', () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    const blunder = search(state, 1, undefined, { qsearch: false });
    expect(blunder.move?.from).toBe(sq('b1'));
    expect(blunder.move?.to).toBe(sq('b8'));
    // +3.90 pawns: the Rf8xb8 recapture is at the horizon, invisible to
    // the raw static evaluation (this is the blunder qsearch fixes).
    expect(blunder.score).toBe(390);
  });

  it('WITH qsearch the recapture is resolved: Qxb8 is scored negatively and NOT played', () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    const fixed = search(state, 1, undefined, { qsearch: true });
    expect(fixed.move?.from).toBe(sq('b1'));
    expect(fixed.move?.to).not.toBe(sq('b8'));
    // The engine saves the queen off the b-file instead.
    expect(fileOf(fixed.move!.to)).not.toBe(fileOf(sq('b1')));

    // Qxb8's true score resolves the recapture: black's Rf8xb8 wins the
    // queen, so White is down a rook (-500) instead of +390.
    const qb8 = generateLegalMoves(state).find(
      (m) => m.from === sq('b1') && m.to === sq('b8'),
    );
    expect(qb8).toBeDefined();
    makeMove(state, qb8!);
    const child = quiescenceSearch(state, -Infinity, Infinity);
    unmakeMove(state);
    expect(-child.score).toBe(-500);
    expect(fixed.score).toBeGreaterThan(-child.score);
  });
});

describe('Scenario 7: node count stays bounded vs plain search', () => {
  it('depth 4 with qsearch stays within the locked-in bounds on startpos (< 3x) and Kiwipete (< 5x)', () => {
    const startPlain = search(parseFen(START_FEN), 4, undefined, {
      qsearch: false,
    });
    const startQ = search(parseFen(START_FEN), 4, undefined, { qsearch: true });
    // Measured outside coverage: 12,211 → 22,319 nodes (1.83x).
    expect(startQ.nodes).toBeLessThan(3 * startPlain.nodes);

    const kiwipetePlain = search(parseFen(KIWIPETE_FEN), 4, undefined, {
      qsearch: false,
    });
    const kiwipeteQ = search(parseFen(KIWIPETE_FEN), 4, undefined, {
      qsearch: true,
    });
    // Measured outside coverage: 93,154 → 250,783 nodes (2.69x).
    expect(kiwipeteQ.nodes).toBeLessThan(5 * kiwipetePlain.nodes);
  }, 300_000);
});

describe('Scenario 8: time budget is respected through qsearch', () => {
  it('the stop flag truncates qsearch: returns the best score found so far', () => {
    const state = parseFen(MATE_CAPTURE_FEN);
    let checks = 0;
    const result = quiescenceSearch(state, -Infinity, Infinity, {
      shouldAbort: () => ++checks > 1,
    });
    expect(result.aborted).toBe(true);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(state).toEqual(parseFen(MATE_CAPTURE_FEN)); // no corruption
  });

  it('an expiring budget during qsearch still returns a legal best move on time', () => {
    const state = parseFen(MATE_CAPTURE_FEN);
    const legal = generateLegalMoves(state);
    // Deterministic call sequence: 1 = start, 2 = elapsed after depth 1,
    // 3 = first depth-2 negamax entry, 4 = first depth-0 negamax entry,
    // 5 = qsearch root entry -> the budget expires inside qsearch.
    let calls = 0;
    const now = () => (++calls >= 5 ? 1_000 : 0);
    const result = searchWithTime(state, {
      timeMs: 500,
      now,
      maxDepth: 3,
      qsearch: true,
    });
    // A legal move on time: the aborted depth-2 iteration falls back to
    // the last fully completed one (depth 1, which never aborts).
    expect(
      legal.some(
        (m) =>
          m.from === result.move?.from &&
          m.to === result.move?.to &&
          m.promotion === result.move?.promotion,
      ),
    ).toBe(true);
    expect(result.depth).toBe(1);
    expect(result.move).toEqual(
      search(state, 1, undefined, { qsearch: true }).move,
    );
    expect(state).toEqual(parseFen(MATE_CAPTURE_FEN));
  });
});

describe('abort handling in the search.ts integration (PM regression)', () => {
  it('an aborted qsearch stores nothing to the TT: no truncated depth-0 exact entry', () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    const tt = new TranspositionTable();
    // fireAfter=7 from the PM's repro: the deadline fires inside the first
    // depth-0 node's qsearch. This used to store the truncated 95 for a
    // child whose true qsearch value is 1000 (bound 'exact', depth 0),
    // poisoning later probes. The depth-0 branch must throw instead.
    let calls = 0;
    expect(() =>
      search(state, 1, undefined, {
        qsearch: true,
        tt,
        shouldAbort: () => ++calls > 7,
      }),
    ).toThrow(SearchTimeoutError);
    // After the aborted search, every depth-0 child entry still in the TT
    // must be a fully resolved value — verified against an independent,
    // unaborted qsearch of the same position.
    for (const move of generateLegalMoves(state)) {
      makeMove(state, move);
      const entry = tt.probe(state.zobristKey, 0);
      if (entry !== null) {
        const trueScore = quiescenceSearch(state, -Infinity, Infinity).score;
        // Children of a depth-1 root sit at ply 1, so table coordinates
        // are converted back at ply 1 (identity for centipawn scores).
        expect(
          scoreFromTT(entry.score, 1),
          `child ${move.from}->${move.to}`,
        ).toBe(trueScore);
      }
      unmakeMove(state);
    }
  });

  it("an abort inside the LAST root move's qsearch still aborts the iteration", () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    // Measure how many deadline checks a full, unaborted run performs…
    let calls = 0;
    search(state, 1, undefined, {
      qsearch: true,
      shouldAbort: () => {
        calls++;
        return false;
      },
    });
    const total = calls;
    expect(total).toBeGreaterThan(1);
    // …then fire the deadline on the very LAST check — inside the last
    // root move's qsearch. The search must abort the whole iteration, not
    // complete normally with a truncated score (the clean-stop guarantee).
    calls = 0;
    expect(() =>
      search(state, 1, undefined, {
        qsearch: true,
        shouldAbort: () => ++calls > total - 1,
      }),
    ).toThrow(SearchTimeoutError);
    expect(calls).toBe(total);
  });

  it("searchWithTime falls back to the last completed depth when the abort lands in the last root move's qsearch", () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    // Measure the clock-call pattern of a full maxDepth-2 qsearch run.
    let total = 0;
    searchWithTime(state, {
      timeMs: 1_000_000,
      maxDepth: 2,
      qsearch: true,
      now: () => {
        total++;
        return 0;
      },
    });
    // Call 1 = start, call 2 = elapsed after depth 1, the depth-2
    // iteration's deadline checks follow, and the final call is the
    // elapsed check after depth 2. So call (total - 1) is the last
    // deadline check of the depth-2 iteration — inside the last root
    // move's qsearch. Expiring there must abandon the whole iteration.
    let calls = 0;
    const result = searchWithTime(state, {
      timeMs: 500,
      maxDepth: 2,
      qsearch: true,
      now: () => (++calls === total - 1 ? 1_000 : 0),
    });
    expect(result.depth).toBe(1);
    expect(result.move).toEqual(
      search(state, 1, undefined, { qsearch: true }).move,
    );
  });
});

describe('depth-0 root with qsearch', () => {
  it('search(state, 0, { qsearch: true }) extends the depth-0 horizon at the root too', () => {
    const state = parseFen(HANGING_QUEEN_FEN);
    const raw = search(state, 0, undefined, { qsearch: false });
    const resolved = search(state, 0, undefined, { qsearch: true });
    expect(raw.move).toBeNull();
    expect(resolved.move).toBeNull();
    // Without qsearch the score is the raw static evaluation; with it the
    // position's tactics are resolved (matching a standalone qsearch).
    expect(raw.score).toBe(evaluate(state));
    const standalone = quiescenceSearch(state, -Infinity, Infinity);
    expect(resolved.score).toBe(standalone.score);
    expect(resolved.nodes).toBe(standalone.nodes);
  });

  it('an abort inside the depth-0 root qsearch throws SearchTimeoutError', () => {
    let calls = 0;
    expect(() =>
      search(parseFen(HANGING_QUEEN_FEN), 0, undefined, {
        qsearch: true,
        shouldAbort: () => ++calls > 0,
      }),
    ).toThrow(SearchTimeoutError);
  });
});

describe('transposition table integration (#20)', () => {
  it('a repeated position is served from the TT with no duplicate qsearch work', () => {
    const tt = new TranspositionTable();
    const first = quiescenceSearch(
      parseFen(MATE_CAPTURE_FEN),
      -Infinity,
      Infinity,
      {
        tt,
      },
    );
    const warm = quiescenceSearch(
      parseFen(MATE_CAPTURE_FEN),
      -Infinity,
      Infinity,
      {
        tt,
      },
    );
    expect(warm.score).toBe(first.score);
    expect(warm.nodes).toBe(1); // served entirely from the stored root entry
    expect(warm.nodes).toBeLessThan(first.nodes);
  });

  it('the TT never changes the qsearch answer (same move and score at fixed depth)', () => {
    const base = search(parseFen(HANGING_QUEEN_FEN), 2, undefined, {
      qsearch: true,
    });
    const withTT = search(parseFen(HANGING_QUEEN_FEN), 2, undefined, {
      qsearch: true,
      tt: new TranspositionTable(),
    });
    expect(withTT.move).toEqual(base.move);
    expect(withTT.score).toBe(base.score);
  });
});

describe('explosion safety', () => {
  it('the max-ply cap stops the capture chain and returns a finite score', () => {
    // The hanging-queen position has a 2-ply capture chain (Qxb8 then
    // Rf8xb8). With maxPly 1 the recapture is NOT expanded — each child
    // of the root is evaluated statically — so the tree is far smaller.
    const state = parseFen(HANGING_QUEEN_FEN);
    const capped = quiescenceSearch(state, -Infinity, Infinity, { maxPly: 1 });
    const full = quiescenceSearch(state, -Infinity, Infinity);
    expect(capped.nodes).toBe(2); // root + the capped Qxb8 child
    expect(capped.nodes).toBeLessThan(full.nodes); // full resolves the chain
    expect(Number.isFinite(capped.score)).toBe(true);
  });
});

describe('qsearch matches an unpruned reference', () => {
  /** The reference: the same qsearch algorithm without move ordering or
   * the TT. The stand-pat raise (alpha = max(alpha, eval)) is intrinsic
   * to qsearch — it narrows the window so child fail-highs prune sibling
   * captures; without it the capture tree explodes combinatorially. */
  function referenceQsearch(
    state: BoardState,
    alpha: number,
    beta: number,
    ply: number,
  ): number {
    const moves = generateLegalMoves(state).filter(
      (m) => (state.board[m.to]?.type ?? null) !== 'king',
    );
    if (moves.length === 0) {
      return isInCheck(state, state.turn) ? -(MATE_SCORE - ply) : 0;
    }
    if (ply >= 8) {
      return evaluate(state);
    }
    const inCheck = isInCheck(state, state.turn);
    let best: number;
    if (!inCheck) {
      const standPat = evaluate(state);
      if (standPat >= beta) {
        return beta;
      }
      best = standPat;
      if (standPat > alpha) {
        alpha = standPat;
      }
    } else {
      best = -Infinity;
    }
    const searched = inCheck ? moves : moves.filter(isTacticalRef);
    if (searched.length === 0) {
      return best;
    }
    for (const move of searched) {
      makeMove(state, move);
      const score = -referenceQsearch(state, -beta, -alpha, ply + 1);
      unmakeMove(state);
      if (score > best) {
        best = score;
      }
      if (best > alpha) {
        alpha = best;
      }
      if (alpha >= beta) {
        break;
      }
    }
    return best;
  }

  /** Capture or promotion (mirrors the production's `isTactical`). */
  function isTacticalRef(move: Move): boolean {
    return (move.flags & (MoveFlags.CAPTURE | MoveFlags.PROMOTION)) !== 0;
  }

  it('returns the same score as the reference across the issue fixtures', () => {
    for (const fen of [
      HANGING_QUEEN_FEN,
      IN_CHECK_FEN,
      PROMOTION_FEN,
      MATE_CAPTURE_FEN,
      EN_PASSANT_FEN,
      UP_A_QUEEN_FEN,
      QUIET_FEN,
      START_FEN,
      KIWIPETE_FEN,
    ]) {
      const state = parseFen(fen);
      const actual = quiescenceSearch(state, -Infinity, Infinity);
      expect(actual.score, fen).toBe(
        referenceQsearch(state, -Infinity, Infinity, 0),
      );
      expect(state).toEqual(parseFen(fen));
    }
  }, 120_000);
});

describe('search integration regression', () => {
  it('with qsearch enabled, search still returns a legal move for every fixture at depth 1-2', () => {
    for (const fen of PERFT_FIXTURE_FENS) {
      const state = parseFen(fen);
      const legal = generateLegalMoves(state);
      for (const depth of [1, 2]) {
        const result = search(state, depth, undefined, { qsearch: true });
        expect(
          legal.some((m) => sameMove(m, result.move)),
          `${fen} depth ${depth}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it('searchWithTime runs to the same completed depth with qsearch enabled', () => {
    const without = searchWithTime(parseFen(START_FEN), {
      timeMs: 1_000_000,
      maxDepth: 2,
      now: () => 0,
    });
    const withQ = searchWithTime(parseFen(START_FEN), {
      timeMs: 1_000_000,
      maxDepth: 2,
      now: () => 0,
      qsearch: true,
    });
    expect(withQ.depth).toBe(without.depth);
    expect(withQ.move).not.toBeNull();
    expect(isLegalMove(parseFen(START_FEN), withQ.move)).toBe(true);
  }, 60_000);

  function isLegalMove(state: BoardState, move: Move | null): boolean {
    return (
      move !== null && generateLegalMoves(state).some((m) => sameMove(m, move))
    );
  }
});
