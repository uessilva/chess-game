---
description: Runs the full development loop — pick issues, implement, QA, PM review, open PRs, repeat. Usage: /execute [#N | number-of-issues]
model: opencode-go/deepseek-v4-flash
---

# Execute Development Loop

Run the full issue pipeline as defined in `AGENTS.md`.

Arguments (`$ARGUMENTS`):

- `#N` (e.g. `/execute #5`) → **focus on that single issue only**; run it through the full lifecycle (groom → implement → QA → PM accept → PR) and do not pick any other issues this batch.
- a number (e.g. `/execute 3`) → batch size (default: 2); pick that many lowest-numbered groomed unblocked issues.

The lifecycle: PM grooms → Engineer builds → Tester verifies → PM accepts → Open PR → Owner merges. See `AGENTS.md` for the roadmap phases, issue numbering (X.Y), quality gates, and PR workflow.

## Run Policy

- **Model:** all pipeline subagents use their configured model (opencode-go/kimi-k3); no overrides needed. The agents live in `.opencode/agents/` (product-manager, software-engineer, tester, designer).
- **Concurrency:** run at most three active subagents by default across grooming, implementation, QA, and PM review. Use fewer when there are fewer independent eligible tracks. Only exceed three when the owner explicitly asks for a larger burst.

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

After picking issues, create a todo list with the todowrite tool so the owner can track progress. Per batch:

1. "Implement #N (Title)" — one per issue, status: in_progress
2. "QA #N (Title)" — blocked by the implement task
3. "PM review #N (Title)" — blocked by QA
4. "Open PRs for batch" — blocked by all PM reviews
5. "Pick next batch" — blocked by the PR task

Update task status as work progresses: pending -> in_progress -> completed.

## Step 2: Implement (parallel)

Launch software-engineer subagents in parallel for each picked issue:

```
Task(subagent_type="software-engineer", prompt="Implement issue #N. Read AGENTS.md first. Read the issue with gh issue view N. Follow the acceptance criteria and test scenarios. Write code and tests (Vitest; perft fixtures for move-generation changes). Run npm run check before reporting. Do NOT commit.")
```

Wait for all engineers to complete. If an engineer reports a blocker, skip that issue and note it.

## Step 3: QA (parallel)

For each completed implementation, launch a tester subagent:

```
Task(subagent_type="tester", prompt="QA issue #N. Read AGENTS.md first. The engineer wrote {description}. Review the code and tests, run the focused tests and perft fixtures, then npm run check and npm run build. Report pass/fail with specifics.")
```

## Step 4: Handle QA Results

For each issue:

- QA PASSES: proceed to PM review
- QA FAILS: relay the specific feedback to the engineer, re-implement, re-QA (max 2 retries)
- QA fails after 2 retries: skip the issue, report it, continue with the others

## Step 5: PM Acceptance Review (parallel)

For each QA-passed issue, launch the product-manager subagent for acceptance review:

- Changes under `src/ui/**` → UX review
- Core/engine/infra changes → DX review

```
Task(subagent_type="product-manager", prompt="You are the Product Manager agent doing acceptance review for issue #N. Read AGENTS.md first. Read .opencode/agents/product-manager.md for your review checklist. Review the implementation from the user's (or API consumer's) perspective. Report ACCEPT or REJECT with specifics.")
```

## Step 6: Handle PM Results

For each issue:

- PM ACCEPTS: proceed to open the PR
- PM REJECTS: relay the UX/DX feedback to the engineer, fix, re-run PM review (max 2 retries)

Do NOT close issues yourself — the PR body's `Closes #N` closes the issue when the owner merges.

## Step 7: Open PRs (one per accepted issue)

`AGENTS.md` requires one small PR per task. Open them sequentially, using each issue's specific files (never `git add -A`):

```bash
git checkout -b task/{N}-{short-slug}
git add {specific files reported by the engineer for issue N}
git commit -m "{prefix}: {short phrase}"    # feat|fix|docs|chore, header ≤72 chars, no trailing period
git push -u origin task/{N}-{short-slug}
gh pr create --title "{Title}" --body "$(cat <<'EOF'
## Task

Closes #{N}

## Context

{why the change is needed, briefly}

## Solution

{what was done, briefly}

## Testing

{vitest output, perft results, npm run check}

---

*Generated with {model} for ${cost}.*
EOF
)"
git checkout main
```

- `{prefix}` matches commitlint: `feat`, `fix`, `docs`, or `chore`.
- The footer's `{model}` and `{cost}` come from the OpenCode DB (`~/.local/share/opencode/opencode.db`, table `session` — match this repo's session by `directory`, pick latest `time_updated`; round cost to 2 decimals).
- Issues with `[HUMAN]` criteria: use `Refs #{N}` instead of `Closes #{N}` in the PR body (issue stays open until the owner verifies), and list the human-verification items in the Testing section.

## Step 8: Check CI

After opening PRs, check the runs:

```bash
sleep 10
gh run list --limit 3
```

If a required check fails, report it to the owner with the failing workflow and job — do not merge or bypass. Fix forward in a follow-up PR.

## Step 9: Repeat

Go back to Step 1 and pick the next batch. Never stop until all open issues are done or no actionable issues remain.

## Summary Format

After each batch, report:

```
## Batch N Complete

| Issue | Type | Engineer | QA | PM | Status |
|-------|------|----------|----|----|--------|
| #X Title | Feature | DONE | PASS | ACCEPT | PR #12 |
| #Y Title | Core | DONE | PASS | ACCEPT | PR #13 |

Tests: X vitest + perft at depth 4-5, all green; npm run check passes
Next: picking issues for batch N+1...
```
