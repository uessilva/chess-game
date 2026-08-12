import { describe, expect, it } from 'vitest';

import {
  benchConfig,
  buildBaseline,
  compareToBaseline,
  environment,
  loadBaseline,
  runPosition,
  writeBaseline,
  type BenchResult,
  type ComparisonRow,
} from './bench';
import { BENCH_POSITIONS } from './positions';

/**
 * The reproducible nodes/sec bench (task 3.7, #22). Runs via
 * `npm run bench` (Vitest with `vitest.bench.config.ts` — a separate
 * invocation, so the bench never executes under `npm test`, `npm run
 * check`, or CI). Each position is searched at its fixed depth
 * `DEFAULT_ITERATIONS` times, every iteration on a fresh search state
 * (new parse, new transposition table — nothing shared), and the summary
 * reports the median with the min/max spread.
 *
 * Modes (see bench/README.md):
 * - default: run + print the summary table
 * - `npm run bench:update`  (BENCH_UPDATE=1): also write bench/baseline.json
 * - `npm run bench:compare` (BENCH_COMPARE=1): compare against the committed
 *   baseline and FAIL on a regression beyond the documented tolerances
 *
 * Node counts are asserted identical across iterations: the search is
 * deterministic, so any spread means something shared state leaked into
 * the search — the bench must be a clean measurement or it is measuring
 * noise.
 */
describe('nodes/sec bench', () => {
  // The full run (4 positions × 5 iterations) targets ≈ 2 minutes on a
  // typical laptop; give slow machines a wide margin before failing.
  it('runs the fixed positions at fixed depths and reports median nodes/sec', () => {
    const mode =
      process.env.BENCH_UPDATE === '1'
        ? 'update'
        : process.env.BENCH_COMPARE === '1'
          ? 'compare'
          : 'run';
    const out = process.stdout;
    const results: BenchResult[] = [];
    const startedAt = performance.now();

    out.write('\n');
    out.write('==========================================================\n');
    out.write(' nodes/sec bench (fixed depth, fresh TT per iteration)\n');
    out.write(` mode: ${mode}  iterations: ${benchConfig().iterations}\n`);
    out.write('==========================================================\n');

    for (const position of BENCH_POSITIONS) {
      out.write(`\n  ${position.label} — depth ${position.depth}...\n`);
      const result = runPosition(position);
      results.push(result);

      // Determinism self-check: the same code + machine must produce
      // identical node counts on every fresh-state iteration.
      const nodeCounts = result.iterations.map((i) => i.nodes);
      expect(
        new Set(nodeCounts).size,
        `node counts must be identical across iterations for ${position.name} (got ${nodeCounts.join(', ')})`,
      ).toBe(1);
    }

    const elapsed = (performance.now() - startedAt) / 1000;
    out.write('\n');
    printTable(out, results);

    if (mode === 'update') {
      const baseline = buildBaseline(results, benchConfig().iterations);
      writeBaseline(baseline);
      out.write(
        `\nWrote baseline to bench/baseline.json ` +
          `(node ${baseline.meta.node}, ${baseline.meta.platform}, ${baseline.meta.cpu})\n`,
      );
    }

    if (mode === 'compare') {
      const baseline = loadBaseline();
      warnOnEnvironmentMismatch(out, baseline.meta);
      const rows = compareToBaseline(results, baseline);
      printComparison(out, rows);
      const failures = rows.filter((row) => row.failed);
      if (failures.length > 0) {
        throw new Error(
          `bench: regression vs baseline — ` +
            failures
              .map((f) => `${f.name}: ${f.failureReasons.join('; ')}`)
              .join(' | '),
        );
      }
      out.write('\nPASS: no regression beyond the documented tolerances.\n');
    }

    out.write(`\nTotal wall time: ${elapsed.toFixed(1)}s\n\n`);
  }, 900_000);
});

/** Right-aligned helper for the summary table. */
function pad(value: string, width: number): string {
  return value.padStart(width);
}

/** Print the one-row-per-position summary table. */
function printTable(
  out: { write(s: string): void },
  results: readonly BenchResult[],
): void {
  const col = (value: string, width: number): string => pad(value, width);
  out.write(
    col('position', 12) +
      col('depth', 6) +
      col('nodes', 12) +
      col('wall ms', 10) +
      col('nodes/s', 10) +
      col('min', 11) +
      col('max', 11) +
      '\n',
  );
  out.write('-'.repeat(72) + '\n');
  for (const result of results) {
    const { position, median, min, max } = result;
    out.write(
      col(position.name, 12) +
        col(String(position.depth), 6) +
        col(median.nodes.toLocaleString('en-US'), 12) +
        col(median.elapsedMs.toFixed(0), 10) +
        col(Math.round(median.nodesPerSec).toLocaleString('en-US'), 10) +
        col(Math.round(min.nodesPerSec).toLocaleString('en-US'), 11) +
        col(Math.round(max.nodesPerSec).toLocaleString('en-US'), 11) +
        '\n',
    );
  }
  out.write('-'.repeat(72) + '\n');
  out.write('(min/max = nodes/sec spread across iterations; the reported\n');
  out.write(' nodes/sec is the median; node counts are deterministic.)\n');
}

/** Warn (loudly, without failing) when the run environment differs. */
function warnOnEnvironmentMismatch(
  out: { write(s: string): void },
  meta: { node: string; platform: string; cpu: string },
): void {
  const current = environment();
  const mismatch: string[] = [];
  if (current.node !== meta.node) {
    mismatch.push(`node ${meta.node} -> ${current.node}`);
  }
  if (current.platform !== meta.platform) {
    mismatch.push(`platform ${meta.platform} -> ${current.platform}`);
  }
  if (current.cpu !== meta.cpu) {
    mismatch.push(`cpu "${meta.cpu}" -> "${current.cpu}"`);
  }
  if (mismatch.length > 0) {
    out.write(
      '\nWARNING: environment differs from the baseline (' +
        mismatch.join(', ') +
        ').\n' +
        '  Node counts stay comparable (deterministic), but nodes/sec is\n' +
        '  machine-dependent — compare nodes/sec only on the same hardware.\n',
    );
  }
}

/** Print per-position deltas vs the committed baseline. */
function printComparison(
  out: { write(s: string): void },
  rows: readonly ComparisonRow[],
): void {
  const col = (value: string, width: number): string => pad(value, width);
  out.write('\nCompare vs bench/baseline.json\n');
  out.write(
    col('position', 12) +
      col('nodes', 12) +
      col('d_nodes', 9) +
      col('nps', 11) +
      col('d_nps', 9) +
      col('verdict', 20) +
      '\n',
  );
  out.write('-'.repeat(73) + '\n');
  for (const row of rows) {
    out.write(
      col(row.name, 12) +
        col(row.currentNodes.toLocaleString('en-US'), 12) +
        col(signedPercent(row.nodeDeltaPercent), 9) +
        col(Math.round(row.currentNodesPerSec).toLocaleString('en-US'), 11) +
        col(signedPercent(row.nodesPerSecDeltaPercent), 9) +
        col(row.failed ? 'FAIL' : 'ok', 20) +
        '\n',
    );
  }
  out.write('-'.repeat(73) + '\n');
}

/** Format a percent delta with an explicit sign, e.g. "+3.2%". */
function signedPercent(value: number): string {
  if (Number.isNaN(value)) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
