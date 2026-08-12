import { describe, expect, it } from 'vitest';

import {
  buildBaseline,
  compareToBaseline,
  environment,
  loadBaseline,
  median,
  NODE_COUNT_TOLERANCE_PERCENT,
  NODES_PER_SEC_TOLERANCE_PERCENT,
  runPosition,
  type Baseline,
  type BenchResult,
  type ComparisonRow,
  type IterationResult,
} from './bench';
import { BENCH_POSITIONS, type BenchPosition } from './positions';

const START = BENCH_POSITIONS[0];

/** A synthetic per-position result, built without running a search. */
function fakeResult(
  position: BenchPosition,
  nodes: number,
  nodesPerSec: number,
  elapsedMs = 1000,
): BenchResult {
  const iteration = (n: number, nps: number): IterationResult => ({
    nodes: n,
    elapsedMs,
    nodesPerSec: nps,
  });
  const iterations = [iteration(nodes, nodesPerSec)];
  return {
    position,
    iterations,
    median: { nodes, elapsedMs, nodesPerSec },
    min: { nodes, nodesPerSec },
    max: { nodes, nodesPerSec },
  };
}

/** A committed baseline with one synthetic position. */
function fakeBaseline(nodes: number, nodesPerSec: number): Baseline {
  return {
    meta: {
      node: process.version,
      platform: process.platform,
      cpu: 'fake-cpu',
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    config: {
      iterations: 5,
      ordered: true,
      transpositionTable: true,
      qsearch: false,
    },
    positions: {
      [START.name]: { depth: START.depth, nodes, nodesPerSec },
    },
  };
}

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('returns NaN for an empty array', () => {
    expect(median([])).toBeNaN();
  });
});

describe('runPosition', () => {
  it('produces identical node counts across fresh-state iterations', () => {
    const result = runPosition({ ...START, depth: 2 }, 3);
    const nodeCounts = result.iterations.map((i) => i.nodes);
    expect(new Set(nodeCounts).size).toBe(1);
    expect(result.median.nodes).toBe(nodeCounts[0]);
  });

  it('reports a nodes/sec spread within plausible bounds', () => {
    const result = runPosition({ ...START, depth: 2 }, 3);
    expect(result.median.nodesPerSec).toBeGreaterThan(0);
    expect(result.min.nodesPerSec).toBeGreaterThan(0);
    expect(result.max.nodesPerSec).toBeGreaterThanOrEqual(
      result.min.nodesPerSec,
    );
  });
});

describe('buildBaseline', () => {
  it('records per-position depth, nodes, nodesPerSec and the environment', () => {
    const baseline = buildBaseline([fakeResult(START, 100, 250)], 5);
    expect(baseline.config).toEqual({
      iterations: 5,
      ordered: true,
      transpositionTable: true,
      qsearch: false,
    });
    expect(baseline.positions[START.name]).toEqual({
      depth: START.depth,
      nodes: 100,
      nodesPerSec: 250,
    });
    expect(baseline.meta.node).toBe(process.version);
    expect(baseline.meta.platform).toBe(process.platform);
    expect(typeof baseline.meta.cpu).toBe('string');
    expect(baseline.meta.cpu.length).toBeGreaterThan(0);
  });
});

describe('environment', () => {
  it('includes node version, platform and a non-empty CPU model', () => {
    const env = environment();
    expect(env.node).toBe(process.version);
    expect(env.platform).toBe(process.platform);
    expect(env.cpu.length).toBeGreaterThan(0);
    expect(env.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('loadBaseline', () => {
  it('throws a descriptive error when the baseline is missing', () => {
    expect(() => loadBaseline('/nonexistent/baseline.json')).toThrow(
      /npm run bench:update/,
    );
  });
});

describe('compareToBaseline', () => {
  const row = (rows: ComparisonRow[]): ComparisonRow => rows[0];

  it('passes when nodes and nodes/sec match the baseline', () => {
    const rows = compareToBaseline(
      [fakeResult(START, 100, 250)],
      fakeBaseline(100, 250),
    );
    expect(row(rows).failed).toBe(false);
    expect(row(rows).nodeDeltaPercent).toBe(0);
    expect(row(rows).nodesPerSecDeltaPercent).toBe(0);
  });

  it('fails when the node count increases beyond the documented tolerance', () => {
    const over = 100 * (1 + (NODE_COUNT_TOLERANCE_PERCENT + 1) / 100);
    const rows = compareToBaseline(
      [fakeResult(START, Math.round(over), 250)],
      fakeBaseline(100, 250),
    );
    expect(row(rows).failed).toBe(true);
    expect(row(rows).failureReasons.join(' ')).toMatch(/node count/);
  });

  it('fails when nodes/sec drops beyond the documented tolerance', () => {
    const under = 250 * (1 - (NODES_PER_SEC_TOLERANCE_PERCENT + 1) / 100);
    const rows = compareToBaseline(
      [fakeResult(START, 100, under)],
      fakeBaseline(100, 250),
    );
    expect(row(rows).failed).toBe(true);
    expect(row(rows).failureReasons.join(' ')).toMatch(/nodes\/sec/);
  });

  it('never fails on an improvement (fewer nodes, faster nodes/sec)', () => {
    const rows = compareToBaseline(
      [fakeResult(START, 50, 500)],
      fakeBaseline(100, 250),
    );
    expect(row(rows).failed).toBe(false);
    expect(row(rows).nodeDeltaPercent).toBe(-50);
  });

  it('treats a small noise-level swing as a pass', () => {
    const rows = compareToBaseline(
      [fakeResult(START, 101, 249)],
      fakeBaseline(100, 250),
    );
    expect(row(rows).failed).toBe(false);
  });

  it('fails loudly when a position has no baseline entry', () => {
    const missing = BENCH_POSITIONS[1];
    const baseline = fakeBaseline(100, 250);
    const rows = compareToBaseline([fakeResult(missing, 10, 20)], baseline);
    expect(row(rows).failed).toBe(true);
    expect(row(rows).failureReasons).toContain(
      'no baseline entry for this position',
    );
  });
});
