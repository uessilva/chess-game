/**
 * Nodes/sec benchmark harness (task 3.7, #22).
 *
 * Pure-ish helpers for the reproducible bench: run the fixed-depth search
 * on a position N times (fresh transposition table each iteration, so no
 * state leaks between runs), summarize with the median and the min/max
 * spread, load/save the committed machine-readable baseline, and compare
 * a fresh run against it with documented tolerances. The actual `npm run
 * bench` orchestration lives in `bench/bench.test.ts` (a Vitest
 * invocation, kept out of the default gates exactly like the deep perft
 * tier); this module holds the logic so it can be unit-tested.
 *
 * Node counts at a fixed depth are deterministic for a given code
 * version (the search is pure over the position: move ordering, the
 * transposition table, and quiescence are all deterministic), so the
 * median node count is the regression signal. Wall time / nodes-per-sec
 * is noisy — machine load, JIT warm-up, GC — so the bench reports the
 * median of N iterations with the min/max spread visible rather than
 * hiding the noise.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFen } from '../src/core';
import { search } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/transpositionTable';
import type { BenchPosition } from './positions';

/** Iterations per position: each runs on a fresh search state (empty TT). */
export const DEFAULT_ITERATIONS = 5;

/**
 * Documented compare-mode tolerances (see bench/README.md):
 * - Node count is deterministic, so any node-count INCREASE beyond 5% is
 *   a real search-tree regression (the baseline must be regenerated with
 *   `npm run bench:update` after intentional changes).
 * - Median nodes/sec is noisy across runs/machines; a drop beyond 20%
 *   fails loudly, while smaller swings are treated as machine noise.
 */
export const NODE_COUNT_TOLERANCE_PERCENT = 5;
export const NODES_PER_SEC_TOLERANCE_PERCENT = 20;

/** One measured search run on one position. */
export interface IterationResult {
  /** Nodes visited by the fixed-depth search (deterministic). */
  readonly nodes: number;
  /** Wall time of the run, milliseconds. */
  readonly elapsedMs: number;
  /** `nodes / (elapsedMs / 1000)`. */
  readonly nodesPerSec: number;
}

/** A full per-position bench: N iterations plus the median/min/max. */
export interface BenchResult {
  readonly position: BenchPosition;
  readonly iterations: readonly IterationResult[];
  /** Median of the iteration values (the reported numbers). */
  readonly median: {
    readonly nodes: number;
    readonly elapsedMs: number;
    readonly nodesPerSec: number;
  };
  /** Min/max spread across iterations — the visible noise envelope. */
  readonly min: { readonly nodes: number; readonly nodesPerSec: number };
  readonly max: { readonly nodes: number; readonly nodesPerSec: number };
}

/** Environment metadata recorded in the baseline for like-for-like runs. */
export interface BaselineMeta {
  readonly node: string;
  readonly platform: string;
  readonly cpu: string;
  readonly generatedAt: string;
}

/** The search configuration the bench measures. */
export interface BenchConfig {
  readonly iterations: number;
  readonly ordered: boolean;
  readonly transpositionTable: boolean;
  readonly qsearch: boolean;
}

/** A committed baseline: metadata + per-position depth/nodes/nodes-per-sec. */
export interface Baseline {
  readonly meta: BaselineMeta;
  readonly config: BenchConfig;
  readonly positions: Record<
    string,
    {
      readonly depth: number;
      readonly nodes: number;
      readonly nodesPerSec: number;
    }
  >;
}

/** One per-position comparison row. */
export interface ComparisonRow {
  readonly name: string;
  readonly depth: number;
  readonly baselineNodes: number;
  readonly baselineNodesPerSec: number;
  readonly currentNodes: number;
  readonly currentNodesPerSec: number;
  /** `(current - baseline) / baseline * 100` for nodes. */
  readonly nodeDeltaPercent: number;
  /** Same formula for nodes/sec. */
  readonly nodesPerSecDeltaPercent: number;
  /** True when either delta breaches its documented tolerance. */
  readonly failed: boolean;
  readonly failureReasons: readonly string[];
}

/** The environment the bench is running on. */
export function environment(): BaselineMeta {
  return {
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };
}

/** The measured search configuration (see positions.ts header). */
export function benchConfig(
  iterations: number = DEFAULT_ITERATIONS,
): BenchConfig {
  return {
    iterations,
    ordered: true,
    transpositionTable: true,
    qsearch: false,
  };
}

/** Median of a numeric array (sorts a copy; odd/even both handled). */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Run one fixed-depth search with a fresh transposition table. */
export function runIteration(position: BenchPosition): IterationResult {
  const state = parseFen(position.fen);
  const start = performance.now();
  const result = search(state, position.depth, undefined, {
    tt: new TranspositionTable(),
  });
  const elapsedMs = performance.now() - start;
  return {
    nodes: result.nodes,
    elapsedMs,
    nodesPerSec: (result.nodes / elapsedMs) * 1000,
  };
}

/** Run a position `iterations` times, each with a fresh search state. */
export function runPosition(
  position: BenchPosition,
  iterations: number = DEFAULT_ITERATIONS,
): BenchResult {
  const runs: IterationResult[] = [];
  for (let i = 0; i < iterations; i++) {
    runs.push(runIteration(position));
  }
  const nodes = runs.map((r) => r.nodes);
  const nodesPerSec = runs.map((r) => r.nodesPerSec);
  const elapsedMs = runs.map((r) => r.elapsedMs);
  return {
    position,
    iterations: runs,
    median: {
      nodes: median(nodes),
      elapsedMs: median(elapsedMs),
      nodesPerSec: median(nodesPerSec),
    },
    min: {
      nodes: Math.min(...nodes),
      nodesPerSec: Math.min(...nodesPerSec),
    },
    max: {
      nodes: Math.max(...nodes),
      nodesPerSec: Math.max(...nodesPerSec),
    },
  };
}

/** Build the machine-readable baseline from a fresh run. */
export function buildBaseline(
  results: readonly BenchResult[],
  iterations: number,
): Baseline {
  const positions: Baseline['positions'] = {};
  for (const result of results) {
    positions[result.position.name] = {
      depth: result.position.depth,
      nodes: result.median.nodes,
      nodesPerSec: result.median.nodesPerSec,
    };
  }
  return {
    meta: environment(),
    config: benchConfig(iterations),
    positions,
  };
}

const BASELINE_PATH = fileURLToPath(
  new URL('./baseline.json', import.meta.url),
);

/** Path of the committed baseline file. */
export function baselinePath(): string {
  return BASELINE_PATH;
}

/** Read the committed baseline. Throws a descriptive error if missing. */
export function loadBaseline(path: string = BASELINE_PATH): Baseline {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `bench: cannot read baseline at ${path} — run "npm run bench:update" ` +
        `to generate it (${(error as Error).message})`,
      { cause: error },
    );
  }
  const parsed = JSON.parse(raw) as Baseline;
  if (parsed.positions === undefined || parsed.meta === undefined) {
    throw new Error(`bench: malformed baseline at ${path}`);
  }
  return parsed;
}

/** Write the baseline (used by `npm run bench:update`). */
export function writeBaseline(
  baseline: Baseline,
  path: string = BASELINE_PATH,
): void {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

/** A delta helper: percent change from baseline to current. */
function deltaPercent(baseline: number, current: number): number {
  if (baseline === 0) {
    return 0;
  }
  return ((current - baseline) / baseline) * 100;
}

/**
 * Compare a fresh run against the baseline. A row fails when its node
 * count increased by more than `nodeTolerancePercent` OR its median
 * nodes/sec dropped by more than `nodesPerSecTolerancePercent`.
 * Improvements (fewer nodes, faster nps) never fail — they should be
 * recorded by regenerating the baseline.
 */
export function compareToBaseline(
  results: readonly BenchResult[],
  baseline: Baseline,
  nodeTolerancePercent: number = NODE_COUNT_TOLERANCE_PERCENT,
  nodesPerSecTolerancePercent: number = NODES_PER_SEC_TOLERANCE_PERCENT,
): ComparisonRow[] {
  return results.map((result) => {
    const entry = baseline.positions[result.position.name];
    if (entry === undefined) {
      return {
        name: result.position.name,
        depth: result.position.depth,
        baselineNodes: 0,
        baselineNodesPerSec: 0,
        currentNodes: result.median.nodes,
        currentNodesPerSec: result.median.nodesPerSec,
        nodeDeltaPercent: Number.NaN,
        nodesPerSecDeltaPercent: Number.NaN,
        failed: true,
        failureReasons: ['no baseline entry for this position'],
      };
    }
    const nodeDelta = deltaPercent(entry.nodes, result.median.nodes);
    const npsDelta = deltaPercent(entry.nodesPerSec, result.median.nodesPerSec);
    const reasons: string[] = [];
    if (nodeDelta > nodeTolerancePercent) {
      reasons.push(
        `node count up ${nodeDelta.toFixed(1)}% (> +${nodeTolerancePercent}% tolerance)`,
      );
    }
    if (npsDelta < -nodesPerSecTolerancePercent) {
      reasons.push(
        `nodes/sec down ${npsDelta.toFixed(1)}% (< -${nodesPerSecTolerancePercent}% tolerance)`,
      );
    }
    return {
      name: result.position.name,
      depth: entry.depth,
      baselineNodes: entry.nodes,
      baselineNodesPerSec: entry.nodesPerSec,
      currentNodes: result.median.nodes,
      currentNodesPerSec: result.median.nodesPerSec,
      nodeDeltaPercent: nodeDelta,
      nodesPerSecDeltaPercent: npsDelta,
      failed: reasons.length > 0,
      failureReasons: reasons,
    };
  });
}
