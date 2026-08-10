#!/usr/bin/env node
/* global console, process */
/**
 * Bundle-size gate (task 2.6): gzip every emitted JS+CSS asset under dist/
 * with Node's built-in zlib and compare the total against the configured
 * budget (bundle-budget.json, key maxTotalGzipBytes; the BUDGET_BYTES env
 * override exercises the failure path). Source maps are excluded. Exits
 * non-zero on overage — CI fails loudly, never silently. Zero runtime
 * dependencies beyond Node built-ins.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_CONFIG_FILE = 'bundle-budget.json';
const DIST_DIR = 'dist';

/** Recursively collect emitted .js/.css files (source maps are excluded). */
function collectAssets(dir) {
  const assets = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      assets.push(...collectAssets(fullPath));
    } else if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
      assets.push(fullPath);
    }
  }
  return assets;
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1024).toFixed(1)} kB)`;
}

let config;
try {
  config = JSON.parse(readFileSync(BUDGET_CONFIG_FILE, 'utf8'));
} catch (error) {
  console.error(
    `check:bundle: cannot read ${BUDGET_CONFIG_FILE}: ${error.message}`,
  );
  process.exit(1);
}

const budget =
  process.env.BUDGET_BYTES !== undefined
    ? Number(process.env.BUDGET_BYTES)
    : config.maxTotalGzipBytes;

if (!Number.isFinite(budget) || budget < 0) {
  console.error(
    `check:bundle: invalid budget value: ${
      process.env.BUDGET_BYTES ?? config.maxTotalGzipBytes
    }`,
  );
  process.exit(1);
}

let assets;
try {
  assets = collectAssets(DIST_DIR);
} catch (error) {
  console.error(
    `check:bundle: cannot read ${DIST_DIR} (run "npm run build" first): ${error.message}`,
  );
  process.exit(1);
}

const sized = assets
  .map((file) => ({ file, gzip: gzipSync(readFileSync(file)).length }))
  .sort((a, b) => b.gzip - a.gzip);

const total = sized.reduce((sum, { gzip }) => sum + gzip, 0);

console.log('Bundle budget check (gzipped JS+CSS, source maps excluded)');
console.log(`  Total:   ${formatBytes(total)}`);
console.log(`  Budget:  ${formatBytes(budget)}`);
console.log(`  Headroom: ${formatBytes(Math.max(0, budget - total))}`);
console.log('Largest assets:');
for (const { file, gzip } of sized.slice(0, 5)) {
  console.log(`  - ${relative(DIST_DIR, file)}  ${formatBytes(gzip)}`);
}

if (total > budget) {
  const overage = total - budget;
  const largest = sized
    .map(
      ({ file, gzip }) => `${relative(DIST_DIR, file)} (${formatBytes(gzip)})`,
    )
    .join(', ');
  console.error(
    `\nFAIL: bundle exceeds budget by ${formatBytes(overage)} ` +
      `(total ${formatBytes(total)} > budget ${formatBytes(budget)}). ` +
      `Largest assets: ${largest}`,
  );
  process.exit(1);
}

console.log('\nPASS: bundle within budget.');
