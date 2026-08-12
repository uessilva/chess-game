# Benchmarks (task 3.7)

Two opt-in harnesses for the Phase 3 search stack. Both are deliberately
**excluded from `npm test`, `npm run check`, and CI** (vite.config.ts
excludes `bench/**`; they run only through their own Vitest configs) —
benchmarks measure wall time, so a perf gate would be flaky on noisy CI
hardware. Perf regression tracking is a deferred Phase 3 gate per
AGENTS.md; the compare mode below is the tool for when you want it.

## `npm run bench` — nodes/sec regression tracking

Runs the fixed-depth engine search from four fixed positions, five
iterations each (a fresh parse + fresh transposition table per iteration,
so nothing is shared between runs), and prints a summary table:

| position             | depth | nodes   | wall ms | nodes/s |
| -------------------- | ----- | ------- | ------- | ------- |
| startpos             | 5     | 39,714  | ~2100   | ~18,700 |
| kiwipete             | 4     | 87,711  | ~6100   | ~14,400 |
| perft #5 (promotion) | 5     | 142,946 | ~10,600 | ~13,500 |
| perft #3 (endgame)   | 6     | 64,664  | ~1900   | ~34,100 |

Positions reuse the FENs already committed in
`src/core/perft.fixtures.test.ts` (start position, Kiwipete, and two
midgame/endgame fixtures); depths are tuned so the whole run finishes in
≈ 2 minutes on a typical laptop. The search runs with move ordering on
and a fresh transposition table, **without quiescence** — the same
configuration the Web Worker uses today (`worker.ts` passes no `qsearch`
flag). Quiescence extends the depth-0 horizon dynamically and would blow
the fixed-depth node budget.

**What is reported:** the **median** of the five iterations, with the
min/max nodes/sec spread printed — noise is visible, not hidden. Node
counts at a fixed depth are **deterministic**: the bench asserts all five
iterations agree, so any spread is a bug in the harness, not the engine.

### `npm run bench:update` — regenerate the baseline

Writes `bench/baseline.json`: per-position depth, median nodes, median
nodes/sec, plus environment metadata (Node version, OS, CPU model from
`os.cpus()[0]`) and the measured search configuration, so comparisons are
like-for-like. Commit the updated baseline after intentional search
changes (new features, ordering/optimization work).

### `npm run bench:compare` — opt-in regression check

Loads the committed baseline, re-runs the bench, and prints per-position
delta % for both nodes and nodes/sec. It **fails loudly** (exit code
non-zero) when a position regresses beyond the documented tolerances:

- **node count up more than +5%** — node counts are deterministic, so an
  increase means the search tree actually got bigger (a real regression);
- **median nodes/sec down more than −20%** — nodes/sec is noisy across
  runs/machines, so the band is wider.

Improvements (fewer nodes, faster nodes/sec) never fail — regenerate the
baseline to record them. Running compare on a different machine prints a
loud environment-mismatch warning: node counts still compare (they are
deterministic), but nodes/sec is machine-dependent.

## `npm run spar` — Stockfish WASM sparring (owner-approved)

Plays a 20-game match from the start position: our engine (fixed depth 4,
transposition table on — the worker's configuration) alternating colors
against Stockfish WASM at a limited strength (fixed depth 3 **and** UCI
Skill Level 1, so the opponent is a plausible yardstick the simpler
engine can actually score against). Prints the match report — wins/draws/losses,
score percentage, a rough Elo estimate (simple Elo formula on the score:
`400 * log10(S / (1 - S))`, clamped to ±800), and the first three games'
move lists — to stdout. The dependency is `stockfish.js` (devDependency,
approved by the owner 2026-08-11).

Overridable knobs: `SPAR_GAMES`, `SPAR_OUR_DEPTH`, `SPAR_SF_DEPTH`,
`SPAR_SF_SKILL` (Stockfish Skill Level, 0–20, 20 = full strength), and
`SPAR_REPORT` (a file path to also write the report to).

```
SPAR_GAMES=30 SPAR_OUR_DEPTH=3 SPAR_REPORT=/tmp/spar.txt npm run spar
```
