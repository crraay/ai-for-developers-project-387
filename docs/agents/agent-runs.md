# Agent run controls

The agent workflows (`opencode.yml`, `opencode-review.yml`,
`opencode-triage.yml`, `security.yml`, `todo-fixme-audit.yml`) call a paid
model. Three controls are kept separate on purpose: cancelling a run, blocking
future runs, and checking the provider's own quota.

## The three controls

| Control | Where | What it does |
|---|---|---|
| Cancel a run | `concurrency.cancel-in-progress` | Cancels a superseded run. `opencode.yml` keeps `false` because an in-flight branch edit would be lost; `opencode-review.yml`, `ci.yml` and `pr-title.yml` cancel superseded work. |
| Block future runs | `OPENCODE_DISABLED`, `agent-paused`, per-PR budget | Prevents a new model call before the model is reached. |
| Provider check | `scripts/opencode-preflight.mjs --provider` | Reads the provider's account-wide quota before the model. It does not replace the per-PR budget. |

`concurrency` is not a budget. GitHub keeps one pending run by default even
with `cancel-in-progress: false`: a third run replaces the second waiting one.
Workflows where every queued run matters set `queue: max` (the agent command,
triage, audits, release and deploy workflows); the review workflow deliberately
cancels superseded work instead. The agent command and review run names are the
budget ledger keys.

A re-run keeps the same `run_id` and increments `run_attempt`. The budget sums
`run_attempt`, so a re-run consumes another attempt and a timed-out run cannot
be re-run indefinitely. `timeout-minutes` bounds one attempt only. A cancelled
attempt stays in the history, so cancellation is not a refund. A re-run of a
blocked run stays blocked because its earlier attempt remains counted.

`cancel-in-progress` is set to `${{ github.run_attempt == 1 }}` where a
workflow cancels superseded runs. A re-run (attempt 2 and later) must not cancel
a newer run that is already in progress.

## Per-PR budget

`opencode.yml` counts attempts per PR/issue, and `opencode-review.yml` counts
attempts per PR. The limit is a repository variable:

| Variable | Default | Scope |
|---|---|---|
| `OPENCODE_RUN_BUDGET` | 10 | `/oc` attempts per PR or issue |
| `OPENCODE_REVIEW_BUDGET` | 20 | automatic reviews per PR |
| `OPENCODE_PROVIDER_QUOTA_PERCENT` | 95 | skip when any provider usage window is at or above this percentage |

The attempt is counted from the workflow run history for that workflow and the
run-name key. Skipped runs are ignored, so a draft, fork or paused run does not
consume a slot. Run history expires after the repository's retention period; a
budget that must outlive that needs a persistent ledger, which is a separate
decision. An administrator who deletes workflow runs can also reset the
ledger; this is a cost control, not a security boundary against the owner.

When the budget is exhausted or the provider check refuses, the agent step does
not run. The `/oc` and review workflows use a separate `refuse` job; triage
posts the same message on the issue, and the scheduled audits write it to their
artifact and summary. The PR-facing message contains:

- the reason code (`limit_exhausted`, `provider_quota`, `fork`, `infra`, `timeout` or `agent_failed`),
- the reason text,
- the PR head SHA,
- the workflow run link,
- the used/limit attempts and the provider window percentages,
- **Status: needs human** and the instruction not to retry automatically.

The same text is written to the job summary. The refusal job has no model key.
A separate `report` job handles a run that passed preflight and then failed or
was cancelled: it reads the failed step from the Actions job API and posts
`timeout` (cancelled/timed out), `infra` (setup or transport step) or
`agent_failed` (the agent step) with the last SHA and the log link. It has no
model key either. If the reason is unclear, inspect the linked log; the code is
a routing hint, not a diagnosis.

## Provider quota

The Go usage endpoint is:

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OPENCODE_API_KEY>
```

A `200` response has `usage.rolling`, `usage.weekly` and `usage.monthly`, each
with `status` (`ok` or `rate-limited`) and `percent`. The preflight refuses when
any window is `rate-limited` or at/above `OPENCODE_PROVIDER_QUOTA_PERCENT`, and
on `401`/`403`/other non-`200` responses. The provider's `402` (credits) and
`429` (rate limit) remain the authoritative hard stops; the preflight is a
courtesy that avoids starting a model call that cannot finish.

The provider quota is account-wide. A per-PR budget is still required because
one busy PR can consume the account quota without any other PR being involved.

## Kill switch and pause

- Set the repository variable `OPENCODE_DISABLED=true` to stop new agent runs
  across the workflows. In-flight runs are not cancelled.
- Add the `agent-paused` label to one PR or issue to stop future `/oc` or
  review/triage runs there. Remove the label to allow runs again.
- Raising a budget variable raises the cap for future attempts; it does not
  retroactively erase counted attempts.

## Forks

`opencode-review.yml` already skips forks. `opencode.yml` resolves the PR head
in a secret-free `gate` job and refuses a fork before the `budget` job (which
holds `OPENCODE_API_KEY`) is created. Fork events and `issue_comment` read the
default-branch preflight; only a same-repository `pull_request_review_comment`
reads its own head, so a workflow change can be tested before it lands and a
fork cannot replace the script. `pull_request_review_comment` on a fork is also
secret-free at the GitHub level; `issue_comment` on a fork runs in the base
repository, which is why the explicit fork gate exists.

## Tests

`mise run check:workflows` (also part of `mise run check`) runs:

- `scripts/opencode-preflight.test.mjs`: first attempt, the last allowed
  attempt, and the refused attempt; a re-run consuming another attempt;
  cancelled attempts counted and skipped attempts ignored; provider `ok`,
  `rate-limited`, threshold and unknown-status payloads; the
  fork/same-repository gate; and the `limit_exhausted` / `infra` reason codes.
- `scripts/agent-permissions.test.mjs`: every `OPENCODE_PERMISSION` block is
  valid JSON, is deny-by-default, carries the metacharacter guards after the
  allow rules, and the triage workflow cannot rewrite an issue body or title.
- `scripts/agent-failure-report.test.mjs`: cancelled and timed-out jobs become
  `timeout`, failed setup/transport steps become `infra`, agent-step failures
  become `agent_failed`, and the posted body carries the reason, SHA, run link
  and **Status: needs human**.
- `scripts/agent-issue-edit.test.mjs`: the triage label command accepts only
  `--add-label` with known labels, and rejects `-bPWNED`, `-tPWNED`, long body
  and title flags, unknown labels and missing values.

The end-to-end check on a scratch PR is: exhaust the budget, confirm the model
step is skipped and the refusal comment has the reason, SHA and run link;
re-run the blocked run and confirm it stays blocked; re-run an allowed run and
confirm it consumes another attempt; cancel an attempt and confirm it remains
counted.
