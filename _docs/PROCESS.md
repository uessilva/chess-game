# Development Process

## Overview

We use GitHub Issues to track development of the chess game. All work is tracked
as issues numbered `X.Y`, one per task, grouped by milestone per phase, and
status is tracked on the GitHub Projects kanban board (repo → Projects tab).
Four core agents handle the full lifecycle from raw request to shipped code. A
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
Orchestrator files issue  →  PM grooms          →  Engineer builds  →  Tester verifies  →  PM accepts  →  Open PR → Owner merges
(from intake)                (spec + tests)        (code + tests)      (runs all tests)    (user POV)
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
3. Software Engineer implements the groomed issue — writes code and tests
   locally. Does NOT commit.
4. Tester reviews the code, runs the focused tests, perft fixtures, and the
   `npm run check` gate, and verifies every acceptance criterion. Reports
   pass/fail.
5. Product Manager does final acceptance review from the user's perspective —
   game feel, flow, copy, edge states (UX) or API ergonomics/conventions (DX).
   Reports accept/reject.
6. Software Engineer commits the issue's files on a task branch; the
   orchestrator pushes and opens a PR (`Closes #N` in the PR body).
7. The owner reviews and merges each PR personally; the issue auto-closes on
   merge. CI is checked after opening the PRs; failures are fixed through the
   normal pipeline.

## Agents

| Agent             | File                                    | Role                                                                          |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Product Manager   | `.opencode/agents/product-manager.md`   | Grooms issues into specs (start) + user acceptance review (end)               |
| Designer          | `.opencode/agents/designer.md`          | Audits board/UI surfaces; produces screenshot-backed findings only (Phase 2+) |
| Software Engineer | `.opencode/agents/software-engineer.md` | Implements code + tests, does NOT commit until approved                       |
| Tester            | `.opencode/agents/tester.md`            | Runs all tests, verifies acceptance criteria technically                      |

## Agent Workflow

An orchestrator (top-level session with the human as supervisor, or the
`/execute` command) drives the process. The orchestrator is the manager: it
files raw issues from intake, dispatches role agents, relays handoffs, and
opens PRs. The orchestrator does not personally groom, implement, test, or
accept — those are role-agent jobs.

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
    ├── assigns issue ──► Software Engineer ──► writes code + tests (no commit)
    │                          │
    │                          ▼
    ├── sends to review ──► Tester ──► reviews code, runs tests, verifies criteria
    │                          │
    │                          ▼
    │                     feedback (pass / fail with specifics)
    │                          │
    │         ┌────────────────┘
    │         ▼
    ├── if fail ──► Software Engineer fixes ──► Tester re-reviews
    │                    (repeat until pass)
    │
    ├── if tester passes ──► Product Manager ──► acceptance review (user perspective)
    │                              │
    │                              ▼
    │                         accept / reject
    │                              │
    │         ┌────────────────────┘
    │         ▼
    ├── if reject ──► Software Engineer fixes ──► Product Manager re-reviews
    │
    ├── if accept ──► Software Engineer commits on task branch
    │                    │
    │                    ▼
    │            Orchestrator opens PR (Closes #N) ──► Owner reviews & merges
    │
    └── Orchestrator checks CI after opening PRs; failures fixed via normal pipeline
```

### Detailed Steps

1. Orchestrator files a raw issue from intake using `gh issue create`. The
   owner does not file issues directly through the template; the orchestrator
   captures intake.
2. Product Manager grooms it: scope, acceptance criteria, test scenarios,
   dependencies, milestone, labels.
3. Orchestrator picks the next groomed issue (lowest number first, respecting
   phase order) and assigns it to the software engineer.
4. Software engineer reads the issue, writes code and tests locally (does NOT
   commit).
5. Tester reviews the code, runs the focused tests + perft fixtures + `npm run
check`, reports pass/fail.
6. If tester fails: specific feedback → software engineer fixes → tester
   re-reviews (repeat).
7. If tester passes: Product Manager does acceptance review from the user's
   perspective.
8. If PM rejects: specific UX/DX feedback → software engineer fixes → PM
   re-reviews.
9. If PM accepts: software engineer commits the issue's files on a task branch
   (`<prefix>: <short phrase>`); orchestrator pushes and opens a PR with
   `Closes #N` in the body.
10. Orchestrator checks CI after opening the PRs; any failure is fixed through
    the normal pipeline (issue → SWE → tester → merge). No on-call agent.

### Orchestrator Responsibilities

- The orchestrator is a manager. Its job is to file intake issues, dispatch
  role agents, relay handoffs, open PRs, and keep the pipeline full. It does
  not personally groom, write feature code, run test suites, or do user-facing
  acceptance — those belong to role agents.
- File issues from user intake. Any observation, bug report, link, or feature
  idea that is not in the issue tracker yet should be filed by the orchestrator
  via `gh issue create`. Do this when the intake arrives — do not wait, and do
  not groom it inline.
- Stay in the orchestrator role. Do not personally perform active issue role
  work when a product-manager, software-engineer, or tester agent can own it.
- Launch role agents asynchronously/non-blocking by default. Do not wait on a
  subagent unless its result is the immediate blocker for the next orchestrator
  action; keep grooming or advancing independent issues while agents work.
- Limit active role-agent concurrency to three by default. Count implementer,
  tester, PM acceptance, and grooming agents toward this cap. If fewer than
  three eligible independent tracks exist, run fewer. Only exceed three when
  the owner explicitly asks for a larger burst.
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
- Before launching SWE agents, ensure the working tree has no uncommitted
  changes that would be overwritten. When running multiple SWE agents in
  parallel, pick issues that touch disjoint files, or use `git worktree` for
  isolation.
- When software engineer reports done, launch tester.
- If tester fails: relay feedback to software engineer, re-launch to fix, then
  re-launch tester.
- If tester passes: launch product manager for acceptance review.
- If PM rejects: relay UX/DX feedback to software engineer, fix, then re-launch
  PM.
- If PM accepts: have the software engineer commit on the task branch, then
  open the PR (see "Merging — PR-based" below).
- After opening the PRs, check CI once (`gh run list`); report failures to the
  owner. Do not merge or bypass failed checks.
- When a role agent reports a failure, assign the fix to the right role agent.
  For code/test failures, send the concrete tester findings back to a
  software-engineer agent; for CI/infrastructure failures, fix them through the
  normal pipeline (or report to the owner if infra is out of agent scope).
- After opening a PR, pick the next issues (never stop until all issues are done).

### Merging — PR-based

We DO use GitHub Pull Requests. Every task gets its own small PR; the owner
reviews each one personally (`AGENTS.md`). Open exactly one PR per issue:

1. From the main checkout, confirm `main` is clean and up-to-date with origin:
   `git fetch origin && git status`.
2. Have the software engineer commit the issue's specific files (never
   `git add -A`) on a task branch:
   ```
   git checkout -b task/{N}-{short-slug}
   git add {specific files}
   git commit -m "{prefix}: {short phrase}"
   git push -u origin task/{N}-{short-slug}
   ```
3. Open the PR with the required sections (see `AGENTS.md`): **Task**
   (`Closes #N`), **Context**, **Solution**, **Testing**, and the **Footer**
   (`---` + italic `*Generated with <model> for $<cost>.*` line, cost read from
   the OpenCode DB).
4. The owner merges; `Closes #N` in the PR body auto-closes the issue.
5. Check CI once after opening the PRs.

Why PRs: the owner reviews each change personally and CI gates `main`. The
agent pipeline (PM groom → SWE → tester → PM acceptance) does the pre-merge
review; the PR is the review/merge gate on top of it.

### Mandatory Steps (never skip)

- Every issue goes through ALL stages: PM groom → SWE implement → Tester
  review → PM acceptance → Commit → Open PR → Owner merge → CI check.
- Tester must actually run the scoped local verification — not just review
  code. For core/engine work that means the focused Vitest tests, the perft
  fixtures (depth 4–5 every PR; depth 6 is nightly/manual), and `npm run
check`.
- Tester must capture screenshots for UI-phase issues once the project's
  Playwright setup exists (Phase 2). Screenshots are used by agents to verify
  pages rendered correctly, not just for human review. For core/engine issues
  screenshots don't apply — the tester says so explicitly.
- SWE and tester must update acceptance criteria checkboxes in the issue body
  (`- [ ]` → `- [x]`).
- Never commit or open a PR without tester review, even for "simple" changes.
- Every task gets its own PR, kept small. One issue per PR.
- Agents post issue comments via `gh`, not the orchestrator. Launch the
  relevant agent (PM for acceptance, tester for verdicts) and let it write the
  comment.
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
5. Pick 2 independent issues at a time and run them in parallel (disjoint
   files or separate worktrees).

### Continuous Issue Pipeline

Always keep the pipeline full. When starting a batch, immediately add a "Pick
next issues" task blocked by the current batch. This ensures work never stops.

The orchestrator should not be idle while there is eligible backlog. Keep at
least one role agent running, and usually two independent tracks, whenever
there are groomed unblocked issues and available agent capacity.

```
Batch N: implement + test + accept → open PRs
    └── triggers: "Pick next issues" → Batch N+1 → ...
```

If the owner interrupts with new information while role agents are working,
keep those agents running. Convert the new information into intake issues or PM
grooming work in parallel, then return to orchestrating active handoffs.

### Human Verification

Some acceptance criteria are marked `[HUMAN]` in issues (visual/game-feel
checks, anything that can't be automated). When an issue passes all agent
reviews but has `[HUMAN]` criteria:

1. Open the PR with `Refs #N` instead of `Closes #N` in the body (the issue
   stays open).
2. Comment listing the criteria that need manual verification.
3. Do NOT close the issue — leave it open for the owner to verify and close.
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
