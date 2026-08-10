# Development Process

## Overview

We use GitHub Issues to track development of the chess game. All work is tracked
as issues numbered `X.Y`, one per task, grouped by milestone per phase, and
status is tracked on the GitHub Projects kanban board (repo → Projects tab).
Four core agents handle the full lifecycle from raw request to shipped code
(merged PR). A
designer agent may provide audit/spec support for UI-heavy work (Phase 2+), but
does not replace any lifecycle step.

## Links

- Repo: this repository (`chess-game`)
- Conventions & architecture: [`AGENTS.md`](../AGENTS.md) — the durable rules
- Process: this file — the workflow
- Specs: the groomed issue body IS the spec (the product-manager agent writes
  it). There is no separate `specs/` folder.

## Issue Lifecycle

```
Orchestrator files issue  →  PM grooms   →  Engineer builds & opens PR  →  Tester tests PR  →  PM accepts  →  Orchestrator merges →  next issue
(from intake)                (spec + tests)   (code + tests, Closes #N)     (runs all tests, CI)     (user POV)
```

1. Orchestrator (the top-level session, `build` agent, or the `/execute`
   command) files the raw issue on behalf of the owner. Intake arrives as
   conversational input — bug reports, feature requests, ideas — and is turned
   into a GitHub issue. The orchestrator does NOT groom inline — grooming is
   the PM's job.
2. Product Manager reads the raw request, researches the codebase, and rewrites
   the issue with: scope, acceptance criteria, dependencies, and test
   scenarios (perft fixtures for core work, Given/When/Then for behavior).
   Assigns the phase milestone and any labels.
3. Software Engineer implements the groomed issue — writes code and tests,
   runs the `npm run check` gate locally, commits the issue's files on a task
   branch, pushes, and opens a PR (`Closes #N` in the PR body). CI runs on the
   PR.
4. Tester reviews the PR — checks out the branch, runs the focused tests,
   perft fixtures, and the `npm run check` gate, verifies every acceptance
   criterion, and confirms the PR's CI is green. Reports pass/fail.
5. Product Manager does final acceptance review from the user's perspective —
   game feel, flow, copy, edge states (UX) or API ergonomics/conventions (DX).
   Reports accept/reject.
6. If the PM accepts and CI is green, the orchestrator merges the PR; the
   `Closes #N` body auto-closes the issue.
7. The orchestrator picks the next issue from the backlog. CI failures found
   by the tester are fixed through the normal pipeline.

## Agents

| Agent             | File                                    | Role                                                                          |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Product Manager   | `.opencode/agents/product-manager.md`   | Grooms issues into specs (start) + user acceptance review (end)               |
| Designer          | `.opencode/agents/designer.md`          | Audits board/UI surfaces; produces screenshot-backed findings only (Phase 2+) |
| Software Engineer | `.opencode/agents/software-engineer.md` | Implements code + tests, opens the PR, iterates on review feedback            |
| Tester            | `.opencode/agents/tester.md`            | Tests the PR: runs all tests, verifies acceptance criteria + CI               |

## Agent Workflow

An orchestrator (top-level session with the human as supervisor, or the
`/execute` command) drives the process. The orchestrator is the manager: it
files raw issues from intake, dispatches role agents, relays handoffs, merges
accepted PRs, and picks the next backlog issue after a merge. The orchestrator
does not personally groom, implement, test, or accept — those are role-agent
jobs.

```
User intake (chat / link / bug report / feature idea)
    │
    ▼
Orchestrator files raw issue
    │
    ▼
Product Manager ──► grooms into agent-ready spec (milestone + test scenarios)
    │
    ▼
Orchestrator picks groomed issue (lowest number first)
    │
    ├── assigns issue ──► Software Engineer ──► writes code + tests, commits on
    │     a task branch, opens PR (Closes #N); CI runs on the PR
    │                          │
    │                          ▼
    ├── sends PR to QA ──► Tester ──► checks out PR branch, runs tests + npm run check,
    │     verifies every criterion + CI status
    │                          │
    │                          ▼
    │                     feedback (pass / fail with specifics)
    │                          │
    │         ┌────────────────┘
    │         ▼
    ├── if fail ──► Software Engineer fixes on branch & pushes ──► Tester re-reviews
    │                    (repeat until pass)
    │
    ├── if tester passes ──► Product Manager ──► acceptance review (user perspective)
    │                              │
    │                              ▼
    │                         accept / reject
    │                              │
    │         ┌────────────────────┘
    │         ▼
    ├── if reject ──► Software Engineer fixes on branch & pushes ──► PM re-reviews
    │
    ├── if accept ──► Orchestrator merges PR (confirms CI green first)
    │                    │
    │                    ▼
    │            Issue auto-closes via Closes #N
    │
    └── Orchestrator picks the next issue from the backlog
```

### Detailed Steps

1. Orchestrator files a raw issue from intake using `gh issue create`. The
   owner does not file issues directly through the template; the orchestrator
   captures intake.
2. Product Manager grooms it: scope, acceptance criteria, test scenarios,
   dependencies, milestone, labels.
3. Orchestrator picks the next groomed issue (lowest number first, respecting
   phase order) and assigns it to the software engineer.
4. Software engineer reads the issue, writes code and tests, runs `npm run
check` locally, commits the issue's files on a task branch (`<prefix>:
<short phrase>`), pushes, and opens a PR with `Closes #N` in the body.
5. Tester checks out the PR branch, runs the focused tests + perft fixtures +
   `npm run check`, verifies every acceptance criterion, and confirms the PR's
   CI is green. Reports pass/fail.
6. If tester fails: specific feedback → software engineer fixes and pushes to
   the PR branch → tester re-reviews (repeat).
7. If tester passes: Product Manager does acceptance review from the user's
   perspective.
8. If PM rejects: specific UX/DX feedback → software engineer fixes and pushes
   → PM re-reviews.
9. If PM accepts (and CI is green): the orchestrator merges the PR; the
   `Closes #N` body auto-closes the issue.
10. Orchestrator picks the next issue from the backlog. CI failures found by
    the tester are fixed through the normal pipeline (issue → SWE → tester →
    merge). No on-call agent.

### Orchestrator Responsibilities

- The orchestrator is a manager. Its job is to file intake issues, dispatch
  role agents, relay handoffs, and keep the pipeline full. It does not
  personally groom, write feature code, run test suites, do user-facing
  acceptance, open PRs, or merge — those belong to role agents.
- File issues from user intake. Any observation, bug report, link, or feature
  idea that is not in the issue tracker yet should be filed by the orchestrator
  via `gh issue create`. Do this when the intake arrives — do not wait, and do
  not groom it inline.
- Stay in the orchestrator role. Do not personally perform active issue role
  work when a product-manager, software-engineer, or tester agent can own it.
- Launch role agents asynchronously/non-blocking by default. Do not wait on a
  subagent unless its result is the immediate blocker for the next orchestrator
  action; keep grooming the backlog while agents work.
- The pipeline is serial: one issue at a time through implement → QA → PM
  acceptance → merge → next issue. The only parallel step is PM grooming when a
  batch is requested — groom multiple ungroomed issues concurrently, but run
  only one implementation/QA/acceptance track at a time.
- Role agents use their configured model (opencode-go/kimi-k3). No model
  overrides needed — opencode subagents inherit their file settings.
- Keep role agents running whenever eligible backlog exists. If there is a
  groomed, unblocked issue and agent capacity is available, launch the next
  appropriate role agent instead of leaving the pipeline idle. Only pause when
  dependencies are blocked, agent capacity is exhausted, or all remaining work
  is waiting on owner verification.
- Treat new user feedback, links, screenshots, or raw requests as intake. File
  the raw issue (concise title, quoted reporter context, suspected area label,
  no acceptance criteria), then launch a product-manager agent to groom it.
- For UI-heavy issues, the orchestrator or product manager may invoke the
  designer agent before grooming or acceptance review. The designer produces a
  report only; the product manager still owns acceptance criteria and the
  software engineer still owns implementation.
- Ensure the working tree has no uncommitted changes before starting the next
  issue's implementation.
- When software engineer reports the PR is open, launch tester.
- If tester fails: relay feedback to software engineer, re-launch to fix on
  the PR branch, then re-launch tester.
- If tester passes: launch product manager for acceptance review.
- If PM rejects: relay UX/DX feedback to software engineer, fix on the PR
  branch, then re-launch PM.
- If PM accepts: merge the PR yourself (see "Merging — PR-based" below) after
  confirming CI is green, then pick the next issue.
- Do not merge or bypass failed checks. Merging is gated on the PM's accept
  verdict and green CI (required status checks on `main`).
- When a role agent reports a failure, assign the fix to the right role agent.
  For code/test failures, send the concrete tester findings back to a
  software-engineer agent (fix on the PR branch); for CI/infrastructure
  failures, fix them through the normal pipeline (or report to the owner if
  infra is out of agent scope).
- After a PR merges, pick the next issues (never stop until all issues are done).

### Merging — PR-based

We DO use GitHub Pull Requests. Every task gets its own small PR, opened by the
software engineer, tested by the tester, accepted by the Product Manager, and
merged by the orchestrator. Open exactly one PR per issue:

1. From the main checkout, confirm `main` is clean and up-to-date with origin:
   `git fetch origin && git status`.
2. The software engineer implements, runs `npm run check`, commits the issue's
   specific files (never `git add -A`) on a task branch, pushes, and opens the
   PR:
   ```
   git checkout -b task/{N}-{short-slug}
   git add {specific files}
   git commit -m "{prefix}: {short phrase}"
   git push -u origin task/{N}-{short-slug}
   gh pr create --title "{Title}" --body "{Task / Context / Solution / Testing / Footer}"
   ```
3. The PR body must have the required sections (see `AGENTS.md`): **Task**
   (`Closes #N`), **Context**, **Solution**, **Testing**, and the **Footer**
   (`---` + italic `*Generated with <model> for $<cost>.*` line, cost read from
   the OpenCode DB).
4. The tester checks out the PR branch, runs the focused tests + perft fixtures
   - `npm run check`, verifies every acceptance criterion, and confirms the
     PR's CI is green (`gh pr checks {PR}`). Verdict pass/fail; SWE pushes fixes
     to the same branch and the PR updates automatically.
5. After the tester passes, the Product Manager does the acceptance review
   (UX/DX) and reports accept/reject. On accept, the orchestrator confirms CI
   is green and merges the PR (`gh pr merge {PR} --squash --delete-branch`).
   The `Closes #N` body auto-closes the issue.
6. The orchestrator picks the next issue from the backlog.

Why PRs: CI gates `main` with required status checks, so the automated merge is
only allowed once the agent pipeline (PM groom → SWE → tester → PM acceptance)
approves AND the checks are green. The PR is the review/merge gate.

### Mandatory Steps (never skip)

- Every issue goes through ALL stages: PM groom → SWE implement → SWE opens PR
  → Tester review (incl. CI) → PM acceptance → orchestrator merge → next issue.
- Tester must actually run the scoped local verification — not just review
  code. For core/engine work that means the focused Vitest tests, the perft
  fixtures (depth 4–5 every PR; depth 6 is nightly/manual), and `npm run
check`.
- Tester must confirm the PR's CI is green (`gh pr checks {PR}`); the PM
  re-checks before merging. Never merge a PR whose CI is red or still running.
- Tester must capture screenshots for UI-phase issues once the project's
  Playwright setup exists (Phase 2). Screenshots are used by agents to verify
  pages rendered correctly, not just for human review. For core/engine issues
  screenshots don't apply — the tester says so explicitly.
- SWE and tester must update acceptance criteria checkboxes in the issue body
  (`- [ ]` → `- [x]`).
- Never merge without tester review and green CI, even for "simple" changes.
- Every task gets its own PR, kept small. One issue per PR.
- Agents post comments via `gh`, not the orchestrator. Launch the
  relevant agent (PM for acceptance, tester for verdicts) and let it write the
  comment. The tester's QA verdict (PASS or detailed findings) is always
  published as a comment **on the PR**; the PM's accept/reject also goes on the
  PR. Issue comments are for grooming notes and acceptance-criteria updates.
- Run `npm run check` before opening any PR — it mirrors CI.

### Red CI is never "chronically red" — always fix it

There is no such thing as an acceptable red pipeline. If CI is red, it is red
because a change we made broke it, and the standing response is always to fix
it. Never label a failing suite "flaky", "chronic", or "pre-existing" and move
on.

When any run is red:

1. Find when it turned red. Compare the last green run's commit to the first
   red run's commit (`gh run list --json headSha,conclusion,createdAt`). The
   regression is in that commit range — bisect it.
2. Read the actual failures, not just the summary. Pull `--log-failed` and
   enumerate every failing test across every shard. Deterministic assertion
   failures are real contract drift; timeouts are usually a secondary symptom
   of the same change.
3. Fix the root cause. Where the code regressed, restore the intended
   behavior. Where the contract legitimately changed (e.g. a perft oracle
   updated), update the stale test.
4. Drive it back to green through the normal pipeline (issue → SWE → tester →
   merge), and verify the next run is green.

A failure may only be set aside as unrelated after you have proven it is
unrelated to the current change AND filed a tracked issue to fix it.
"Pre-existing" is a reason to open a fix issue, never a reason to stop.

### How to Pick Issues

1. `gh issue list --state open --limit 50 --json number,title,labels --jq 'sort_by(.number) | .[] | "#\(.number) \(.title) [\(.labels | map(.name) | join(", "))]"'`
2. Skip issues without a `## Test Scenarios` section (not groomed yet).
3. Pick the lowest-numbered open groomed issues first, respecting phase order
   (core before UI before engine/ml).
4. Check the issue's `Depends on` field — don't start until dependencies are
   closed.
5. Pick the next issue to run through the serial pipeline (lowest number
   first). Grooming is the only step that runs in parallel — groom multiple
   ungroomed issues at once when a batch is requested.

### Continuous Issue Pipeline

Always keep the pipeline full. When starting a batch, immediately add a "Pick
next issues" task blocked by the current batch. This ensures work never stops.

The orchestrator should not be idle while there is eligible backlog. Run the
single track continuously — implement → QA → PM accept → merge → next issue —
and keep grooming in parallel whenever a batch is requested.

```
Batch N: groom all (parallel) → implement → open PR → test PR → accept → merge
    └── merge triggers: next issue in batch / "Pick next issues" → Batch N+1 → ...
```

If the owner interrupts with new information while role agents are working,
keep those agents running. Convert the new information into intake issues or PM
grooming work in parallel, then return to orchestrating active handoffs.

### Human Verification

Some acceptance criteria are marked `[HUMAN]` in issues (visual/game-feel
checks, anything that can't be automated). When an issue passes all agent
reviews but has `[HUMAN]` criteria:

1. The software engineer opens the PR with `Refs #N` instead of `Closes #N` in
   the body (the issue stays open).
2. The tester notes the `[HUMAN]` items as "awaiting human verification" in the
   QA report. The orchestrator can still merge the tested PR — the issue stays
   open because the body does not close it.
3. The PM comments listing the criteria that need manual verification; the
   owner verifies and closes the issue.
4. Continue with the next issues (don't wait).

## Labels

The repo's label set is whatever exists — check `gh label list` before
creating issues and reuse existing labels. Suggested categories:

| Category | Labels                                                  |
| -------- | ------------------------------------------------------- |
| Workflow | `needs grooming` (mark issues awaiting PM grooming)     |
| Area     | e.g. `core`, `ui`, `engine`, `infra`                    |
| Priority | `P0` (must have), `P1` (important), `P2` (nice to have) |
| Special  | `human` (code done, needs manual verification)          |

Milestones group issues by roadmap phase — assign the phase milestone when
grooming. Don't invent new labels without need.

## Temporary Files

All agents must use `/tmp/opencode` for temporary files (screenshots, previews,
scratch data). It is opencode's sanctioned temp location, pre-approved for
access, and outside the repo so it never pollutes `git status`.

- Never write temp files to the repo's tracked directories or commit them.
- Create subdirectories inside `/tmp/opencode` as needed
  (e.g. `/tmp/opencode/screenshots/`).

## Short-lived docs (audits, plans, analyses)

Point-in-time documents — audits, remediation plans, one-off analyses, dated
status reports — live in `_docs/audits/`, not at the `_docs/` root. The root is
reserved for evergreen references that stay current (`PROCESS.md` and anything
added alongside it). When you produce a new audit or plan, put it in
`_docs/audits/` using the `YYYY-MM-DD-<topic>.md` filename convention.

## Technology Stack

- Frontend: TypeScript (Web), built with Vite
- Testing: Vitest (unit/integration) with perft node counts as the
  move-generation oracle; coverage via v8 provider
- Quality: ESLint (typescript-eslint) + Prettier + dependency-cruiser,
  enforced in CI via GitHub Actions
- AI: classical search first (minimax/alpha-beta in `src/engine`, running in a
  Web Worker), then ML (Python training sidecar + ONNX inference in the
  browser)
