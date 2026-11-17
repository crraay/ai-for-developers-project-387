# Workflows

## Repository workflows

The main workflows are described in the root
[README.md](../../README.md) (`## AI agent`, `## Testing`, `## Deployment`);
the full set is:

- `ci.yml` — the `mise run check` gate and the Docker smoke test on every push.
- `opencode.yml` — answers `/oc` comments with the write-capable App token.
- `opencode-review.yml` — posts the advisory auto-review on each non-draft PR.
- `opencode-triage.yml` — triages newly opened issues.
- `verify-head.yml` — runs the browser suite from the exact PR head and uploads
  the trace with that SHA.
- `pr-title.yml` — lints the PR title with commitlint.
- `release-please.yml` — maintains the release PR and tags on `dev`.
- `hexlet-check.yml` — the externally managed Hexlet grading workflow (see
  below).
- `security.yml`, `todo-fixme-audit.yml` — weekly OSV and daily TODO/FIXME
  audits.
- `deploy.yml` — manual Render deployment of the selected branch.

The review contract and the run controls live in
[docs/agents/review.md](../../docs/agents/review.md) and
[docs/agents/agent-runs.md](../../docs/agents/agent-runs.md).

## Automatic tests

After completing all the steps in the project, automatic tests will become available to you. Tests are run on each commit - once all tasks in the Hexlet interface are completed, make a commit, and the tests will run automatically.

The hexlet-check.yml file is responsible for running these tests - do not delete this file, edit it, or rename the repository.
