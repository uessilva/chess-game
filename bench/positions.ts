/**
 * Bench positions for the nodes/sec regression harness (task 3.7, #22).
 *
 * Four fixed positions, all reusing FENs already in the repo (the six
 * chessprogrammingwiki perft fixtures in `src/core/perft.fixtures.test.ts`):
 * the start position, Kiwipete, a sharp midgame fixture (Position 5:
 * promotion-heavy, exercises qsearch-adjacent tactics and the PST eval),
 * and an endgame fixture (Position 3: pinned en passant — sparse board,
 * high branching for its material). Depths are tuned so a full `npm run
 * bench` (5 iterations per position, median-reported) completes in roughly
 * 2 minutes on a typical laptop; node counts at these depths are
 * deterministic for a given code version, which is what makes the
 * regression tracking meaningful.
 *
 * Search configuration (recorded in the baseline): move ordering on (the
 * default), a fresh transposition table per iteration, quiescence off —
 * the same configuration the Web Worker uses today (worker.ts passes no
 * `qsearch` flag). Quiescence extends the depth-0 horizon dynamically and
 * balloons fixed-depth node counts well beyond the 2-minute budget, so it
 * is deliberately excluded from the fixed-depth bench.
 */
export interface BenchPosition {
  /** Stable identifier — also the baseline.json key. */
  readonly name: string;
  /** The FEN, verbatim from the perft fixture suite. */
  readonly fen: string;
  /** Fixed search depth for this position. */
  readonly depth: number;
  /** Human label used in the summary table. */
  readonly label: string;
}

export const BENCH_POSITIONS: readonly BenchPosition[] = [
  {
    name: 'startpos',
    label: 'Start position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depth: 5,
  },
  {
    name: 'kiwipete',
    label: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depth: 4,
  },
  {
    name: 'promotion',
    label: 'Perft #5 (promotion)',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    depth: 5,
  },
  {
    name: 'endgame',
    label: 'Perft #3 (endgame)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depth: 6,
  },
];
