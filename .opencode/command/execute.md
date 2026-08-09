---
description: Runs the full development loop — pick issues, implement, open PRs, QA, PM review, orchestrator merges, repeat. Usage: /execute [#N | number-of-issues]
model: opencode-go/deepseek-v4-flash
---

# Execute Development Loop

Run the full issue pipeline as defined in `AGENTS.md`.

Arguments (`$ARGUMENTS`):

- `#N` (e.g. `/execute #5`) → **focus on that single issue only**; run it through the full lifecycle (groom → implement → open PR → QA the PR → PM accept → orchestrator merge) and do not pick any other issues this batch.
- a number (e.g. `/execute 3`) → batch size (default: 2); pick that many lowest-numbered groomed unblocked issues.

The lifecycle: PM grooms → Engineer builds + opens PR → Tester verifies the PR → PM accepts → orchestrator merges → next issue. See `AGENTS.md` for the roadmap phases, issue numbering (X.Y), quality gates, and PR workflow.

## Run Policy

- **Model:** all pipeline subagents use their configured model (opencode-go/kimi-k3); no overrides needed. The agents live in `.opencode/agents/` (product-manager, software-engineer, tester, designer).
- **Concurrency:** the only parallel step is PM grooming when a batch is requested. Implementation, QA, and PM acceptance run serially — one issue at a time through implement → QA → PM accept → merge → next issue.

## Step 0: PM Grooming (parallel)

Before picking issues, check for ungroomed issues and groom them:

```bash
# Find open issues missing a "## Test Scenarios" section (the groomed marker per product-manager.md)
gh issue list --state open --limit 50 --json number,title,labels,body --jq 'sort_by(.number) | .[] | select(.body | test("## Test Scenarios"; "i") | not) | "#\(.number) \(.title)"'
```

For each ungroomed issue, launch the product-manager subagent in parallel:

```
Task(subagent_type="product-manager", prompt="You are the Product Manager agent. Read AGENTS.md first, then read .opencode/agents/product-manager.md for your role. Groom issue #N: gh issue view N. Add Test Scenarios (perft fixtures for core work, Given/When/Then for behavior), clarify acceptance criteria, ensure it is implementation-ready. Update with gh issue edit N --body '...'. Keep existing content and add to it.")
```

Do NOT wait for grooming to finish before picking issues — run grooming in parallel. Newly groomed issues will be available for the next batch.

## Step 1: Pick Issues

**Batch target:** if `$ARGUMENTS` is an issue reference (`#N`), pick exactly that one issue and skip the general selection below (verify it is groomed and unblocked). Otherwise pick `$ARGUMENTS` issues (default 2), lowest number first.

```bash
gh issue list --state open --limit 50 --json number,title,labels --jq 'sort_by(.number) | .[] | "#\(.number) \(.title) [\(.labels | map(.name) | join(", "))]"'
```

Priority order (lowest number first — X.Y numbering means lower = more foundational):

1. Open issues with a `## Test Scenarios` section (groomed, ready to implement)
2. Open issues without one — skip now; they are being groomed in Step 0

Rules:

- Skip issues without a `## Test Scenarios` section (groom them in Step 0)
- Skip issues whose remaining work is blocked on `[HUMAN]` verification (owner must verify)
- Pick the lowest-numbered issues first, respecting phase order (core before UI before engine/ml)
- Check the `Depends on` field — don't start until dependencies are closed
- If no actionable issues remain, report "No actionable issues" and stop

Confirm each pick with `gh issue view {N}` — the body should contain acceptance criteria plus test scenarios (perft oracle counts for core work, BDD scenarios for behavior).

## Step 1b: Create Todo List

After picking issues, create a todo list with the todowrite tool so the owner can track progress. The pipeline is serial — only grooming runs in parallel:

1. "Implement + open PR #N (Title)" — status: in_progress
2. "QA #N (Title)" — blocked by the implement task
3. "PM review + merge #N (Title)" — blocked by QA
4. Repeat steps 1-3 for the next issue in the batch (serially)
5. "Pick next batch" — blocked by all merges

Update task status as work progresses: pending -> in_progress -> completed.

## Step 2: Implement (serial)

Run one issue at a time. Launch the software-engineer subagent for the current issue:

```
Task(subagent_type="software-engineer", prompt="Implement issue #N. Read AGENTS.md first. Read the issue with gh issue view N. Follow the acceptance criteria and test scenarios. Write code and tests (Vitest; perft fixtures for move-generation changes). Run npm run check before committing. Commit on a task branch, push, and open the PR with Closes #N in the body. Report the PR number.")
```

Wait for the engineer to finish. If the engineer reports a blocker, skip that issue, note it, and continue with the next.

## Step 3: QA (serial)

Launch the tester subagent for the current issue's PR:

```
Task(subagent_type="tester", prompt="QA the PR for issue #N (PR #{pr}). Read AGENTS.md first. gh pr checkout {pr}. Review the code and tests against the issue spec, run the focused tests and perft fixtures, then npm run check and npm run build. Verify every acceptance criterion and confirm gh pr checks {pr} is green. Report pass/fail with specifics.")
```

## Step 4: Handle QA Results

- QA PASSES: proceed to PM review
- QA FAILS: relay the specific feedback to the engineer, re-implement, re-QA (max 2 retries)
- QA fails after 2 retries: skip the issue, report it, continue with the next

## Step 5: PM Acceptance Review (serial)

Launch the product-manager subagent for the current issue's PR:

- Changes under `src/ui/**` → UX review
- Core/engine/infra changes → DX review

```
Task(subagent_type="product-manager", prompt="You are the Product Manager agent doing acceptance review for issue #N (PR #{pr}). Read AGENTS.md first. Read .opencode/agents/product-manager.md for your review checklist. Review the PR from the user's (or API consumer's) perspective. Report ACCEPT or REJECT with specifics. Do NOT merge — the orchestrator merges accepted PRs.")
```

## Step 6: Handle PM Results

- PM ACCEPTS: merge the PR yourself (orchestrator), then the issue auto-closes via `Closes #N`. Then move to the next issue in the batch (back to Step 2).
- PM REJECTS: relay the UX/DX feedback to the engineer, fix on the PR branch, re-run PM review (max 2 retries)

## Step 7: Merge Accepted PRs

Merging is the orchestrator's job. Confirm the checks are green, then merge:

```bash
gh pr checks {PR}            # must be all green / complete
gh pr merge {PR} --squash --delete-branch
gh issue view {N} --json state --jq '.state'   # expect CLOSED (or OPEN if [HUMAN])
```

Never merge or bypass checks — a red/pending required check blocks the merge. `Refs #N` PRs (a `[HUMAN]` issue) merge fine; the issue stays open for the owner.

## Step 8: Repeat

Once the batch's issues are done, go back to Step 1 and pick the next batch (grooming new issues in parallel). Never stop until all open issues are done or no actionable issues remain.

## Summary Format

After each batch, report:

```
## Batch N Complete

| Issue | Type | Engineer | QA | PM | Status |
|-------|------|----------|----|----|--------|
| #X Title | Feature | DONE | PASS | ACCEPT | PR #12 → MERGED |
| #Y Title | Core | DONE | PASS | ACCEPT | PR #13 → MERGED |

Tests: X vitest + perft at depth 4-5, all green; npm run check passes
Next: picking issues for batch N+1...
```
