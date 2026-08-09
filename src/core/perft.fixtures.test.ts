import { describe, expect, it } from 'vitest';

import { perft } from './index';

/** One chessprogrammingwiki perft position with its published counts. */
interface PerftFixture {
  /** CPW position name, used in test output. */
  name: string;
  fen: string;
  /** Depths in the default fast tier (every PR via ci.yml). */
  fast: readonly { depth: number; nodes: number }[];
  /** Depths in the opt-in deep tier (PERFT_DEEP=1 / nightly). */
  deep: readonly { depth: number; nodes: number }[];
}

/**
 * The six chessprogrammingwiki perft positions. The node counts are the
 * project's correctness oracle (AGENTS.md): any mismatch means the move
 * generator or make/unmake is wrong. Values from the chessprogrammingwiki
 * perft results page.
 *
 * This file runs in the fast tier (`npm test`, every PR) and the deep tier
 * (`npm run test:perft:deep`). It is EXCLUDED from the coverage-gated run
 * (`npm run test:coverage`): the ~16.5M fast-tier nodes call zobristHash
 * billions of times, overflowing V8's 32-bit coverage counters and making
 * V8 report a covered branch as uncovered. The harness module stays 100%
 * covered by perft.test.ts, so excluding the oracle runs loses no
 * coverage — it only keeps the counters from wrapping.
 */
const FIXTURES: readonly PerftFixture[] = [
  {
    name: 'Position 1: startpos',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fast: [
      { depth: 1, nodes: 20 },
      { depth: 2, nodes: 400 },
      { depth: 3, nodes: 8902 },
      { depth: 4, nodes: 197281 },
      { depth: 5, nodes: 4865609 },
    ],
    deep: [{ depth: 6, nodes: 119060324 }],
  },
  {
    name: 'Position 2: Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    fast: [
      { depth: 1, nodes: 48 },
      { depth: 2, nodes: 2039 },
      { depth: 3, nodes: 97862 },
      { depth: 4, nodes: 4085603 },
    ],
    deep: [{ depth: 5, nodes: 193690690 }],
  },
  {
    name: 'Position 3: pinned en passant',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    fast: [
      { depth: 1, nodes: 14 },
      { depth: 2, nodes: 191 },
      { depth: 3, nodes: 2812 },
      { depth: 4, nodes: 43238 },
      { depth: 5, nodes: 674624 },
    ],
    deep: [],
  },
  {
    name: 'Position 4: en passant',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    fast: [
      { depth: 1, nodes: 6 },
      { depth: 2, nodes: 264 },
      { depth: 3, nodes: 9467 },
      { depth: 4, nodes: 422333 },
    ],
    deep: [{ depth: 5, nodes: 15833292 }],
  },
  {
    name: 'Position 5: promotion',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    fast: [
      { depth: 1, nodes: 44 },
      { depth: 2, nodes: 1486 },
      { depth: 3, nodes: 62379 },
      { depth: 4, nodes: 2103487 },
    ],
    deep: [{ depth: 5, nodes: 89941194 }],
  },
  {
    name: 'Position 6: Kiwipete mirror',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    fast: [
      { depth: 1, nodes: 46 },
      { depth: 2, nodes: 2079 },
      { depth: 3, nodes: 89890 },
      { depth: 4, nodes: 3894594 },
    ],
    deep: [{ depth: 5, nodes: 164075551 }],
  },
];

/**
 * Per-test timeout in ms. The fast tier (default CI) gives the heavy
 * ~4-5M-node runs a 5-minute ceiling and the small depths 1 minute, so a
 * hung harness fails fast on PRs. The deep tier scales with node count:
 * measured throughput is ~90K nodes/s on a dev box, so `nodes / 25`
 * (≈25K nodes/s) leaves a ~4x margin for slower CI runners, floored at
 * 10 minutes so the small deep runs cannot flake on slow hardware.
 */
const FAST_TIMEOUT = (nodes: number): number =>
  nodes > 1_000_000 ? 300_000 : 60_000;
const DEEP_TIMEOUT = (nodes: number): number =>
  Math.max(600_000, Math.ceil(nodes / 25));

describe('perft fixtures (fast tier, every PR)', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      for (const { depth, nodes } of fixture.fast) {
        it(
          `depth ${depth} = ${nodes.toLocaleString('en-US')}`,
          () => {
            expect(perft(fixture.fen, depth)).toBe(nodes);
          },
          FAST_TIMEOUT(nodes),
        );
      }
    });
  }
});

describe.skipIf(process.env.PERFT_DEEP !== '1')(
  'perft fixtures (deep tier, opt-in via PERFT_DEEP=1)',
  () => {
    for (const fixture of FIXTURES) {
      for (const { depth, nodes } of fixture.deep) {
        it(
          `${fixture.name} depth ${depth} = ${nodes.toLocaleString('en-US')}`,
          () => {
            expect(perft(fixture.fen, depth)).toBe(nodes);
          },
          DEEP_TIMEOUT(nodes),
        );
      }
    }
  },
);
