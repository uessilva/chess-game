# AGENTS.md

## Project Overview

Personal learning project: build a chess game to learn **game development** and
**AI engineering**. The owner is a senior software engineer who is new to game
development.

**Tasks live as GitHub issues** on the project board (repo → Projects tab) —
one issue per numbered task (X.Y), grouped by milestone per phase. Work them
in numeric order. The board tracks status and progress; this file holds the
durable conventions.

## Locked-in Decisions

- **Stack:** TypeScript (Web)
- **AI track:** classical search AI first (minimax/alpha-beta), then ML
  (neural evaluation, AlphaZero-style self-play)

## Architecture (the rules that matter)

```
src/
  core/     → board state, move gen, rules (pure TS, NO DOM, no I/O)
  ui/       → rendering, input, animation (depends on core only)
  engine/   → classical AI (depends on core only, runs in a Web Worker)
  ml/       → later: Python training sidecar + ONNX inference in browser
```

- `core/` must stay framework-agnostic and side-effect free. It will later be
  reused as the RL environment — do not couple it to the UI.
- UI state (selection, drag, animation) is strictly separate from core game state.
- Follow the roadmap phases in order. In particular: **no UI work before the
  core passes perft tests.**

## Conventions

- **Testing:** Vitest. Move generation correctness is verified with `perft`
  node counts (known-good values from the chessprogramming wiki) — these are
  the project's oracle. Initial position: depth 4 = 197,281; depth 6 = 119,060,324.
- **Order of work:** correctness → benchmarks → optimization. Never optimize
  `core` before perft passes.
- **Minimal changes:** implement only what the current phase requires.

## Quality Gates

All enforced in CI (GitHub Actions) on every PR, with required status checks
on `main`. `npm run check` runs the same chain locally.

- **Typecheck:** `tsc --noEmit` (Vite dev does NOT typecheck — esbuild strips
  types). tsconfig uses `"strict": true`.
- **Lint/format:** ESLint (typescript-eslint, flat config) + Prettier.
- **Coverage:** Vitest (v8 provider) with thresholds — `src/core/**` at 100%
  lines/branches/functions.
- **Perft tiers:** depth 4–5 on every PR (fast); depth 6 as nightly/manual
  benchmark; Kiwipete & other standard positions as regression fixtures.
- **Module boundaries:** dependency-cruiser enforces `core/` purity (no
  imports from `ui/`/`engine/`, no DOM).
- **Commits:** commitlint enforces the prefix convention (CI check, no local
  hooks).
- **Dependencies:** Dependabot for npm + GitHub Actions.
- **Deferred:** Playwright visual regression + bundle-size budget (Phase 2);
  benchmark regression tracking, nodes/sec (Phase 3).

## Git & PRs

- **Task tracking:** GitHub Projects kanban board — one issue per task,
  milestones per phase. Issues are the source of truth for the plan.
- **Every task gets its own PR, kept small.** One issue per PR. The owner
  reviews each PR personally — favor small, focused diffs; split work further
  rather than opening a large PR.
- **Commit messages:** `<prefix>: <short phrase>` where prefix is one of
  `feat`, `fix`, `docs`, `chore`. Example: `feat: add en passant move generation`.
- **PR body** must include these sections:
  - **Task** — `Closes #N` (every task has an issue)
  - **Context** — why the change is needed, briefly
  - **Solution** — what was done, briefly
  - **Testing** — how it was verified (e.g. vitest output, perft results)

## Commands

Requires Node.js ≥ 20 (run `nvm use` — `.nvmrc` is set; the machine default is old).

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm test` / `npm run test:watch` — Vitest
- `npm run test:coverage` — tests with coverage thresholds enforced
- `npm run typecheck` / `npm run lint` / `npm run format` (`format:check`)
- `npm run check` — full local gate: typecheck + lint + format check + module
  boundaries (`depcruise`) + coverage. Mirrors CI; run it before opening a PR.

## Working with the Owner

- Senior SWE: skip general software engineering explanations.
- New to game dev and AI: **do** explain game-development concepts (game loop,
  rendering, game feel) and AI concepts (search, evaluation, RL) when they come
  up — learning them is the point of the project.
- Ask before introducing libraries or tools not already agreed on (this file,
  project README).

## Maintenance

If you change the structure, stack, conventions, or workflow, update this file.
Task status is tracked on the project board — do not duplicate it here.
