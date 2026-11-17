# Call Calendar

[![hexlet-check](https://github.com/crraay/ai-for-developers-project-387/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/crraay/ai-for-developers-project-387/actions)

Building a booking calendar service together with AI

How it should work: https://files.hexlet.app/a/2ipc5m



## Tech Stack

React 19 + Vite (frontend) · Java 25 + Micronaut (backend) · PostgreSQL · Docker Compose

See [ADR-0001](docs/adr/0001-tech-stack.md) for why this stack was chosen, and
[ADR-0009](docs/adr/0009-react-frontend.md) for the frontend move from Angular to
React.



## Installation

Prerequisites: [mise](https://mise.jdx.dev) (`winget install jdx.mise` on
Windows) and Docker. Tool versions (Java 25, Node 24) are pinned in
`mise.toml`.

```bash
git clone https://github.com/crraay/ai-for-developers-project-387.git
cd ai-for-developers-project-387
mise install
mise run setup
```

`mise run setup` installs the three JavaScript dependency trees (root = e2e +
commitlint, `frontend/` = the app, `typespec/` = the contract compiler) and the
Playwright Chromium browser. It is the same one-time setup CI and the deploy
workflow run, so a clean clone can go straight to `mise run check`. Docker must
be running for the browser test (and for `mise run smoke`).



## Usage

Run the whole stack:

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8080 (`GET /api/ping` → `pong`)
- Swagger UI: http://localhost:8080/swagger-ui/ (raw spec: `/swagger/call-calendar-0.1.yml`)
- PostgreSQL: localhost:5434 (`postgres`/`postgres`, db `callcalendar`; 5432 is used by a local PostgreSQL install on this machine)

Local development without Docker:

```bash
# backend (requires a PostgreSQL, e.g. `docker compose up -d db`;
# override the connection with DATASOURCES_DEFAULT_URL if needed)
cd backend && mise exec -- ./gradlew run

# frontend
cd frontend && mise exec -- npm start
```

### Data persistence

Bookings survive a normal Docker Compose restart: `docker-compose.yml` mounts the named volume `db-data`, so `docker compose down && docker compose up --build` keeps them. `docker compose down -v` wipes the volume (the CI smoke tests do this to start from a clean database).

On Render, the managed Postgres survives service restarts, but the free instance expires on **2026-12-10** and is recreated then — data is not preserved after that.

### Booking types

What a guest books is one of the **booking types** the host has set up — each
type carries its own title, description, and duration, and the guest picks one
instead of choosing a raw duration. The host manages them at
**http://localhost:5173/host/booking-types**; the two seeded types on a fresh
database are:

| Order | Title       | Duration |
| ----- | ----------- | -------- |
| 10    | Quick chat  | 30 min   |
| 20    | Deep dive   | 60 min   |

A guest flow that uses both:

1. Open **http://localhost:5173/book**, pick a day, and choose **Deep dive**
   from the *Booking type* picker.
2. Click any of the time slots — each one carries the chosen `bookingTypeId`,
   so picking the same slot with **Quick chat** would show 30-minute windows
   instead.
3. Fill in name + email on the confirm form, which now also shows the type's
   title and description, and submit — the booking is created with that
   type's duration derived server-side.
4. On the host view (**/host**), every row shows the type the guest chose
   (e.g. *"Mon, 03 Nov, 14:00–15:00 · Deep dive"*).

Hiding a type (uncheck *Visible* in the editor) takes it off the guest picker
without deleting past bookings; deleting it is irreversible but the type label
stays attached to existing rows.

### Booking window

The guest calendar opens on the current host-local day and covers the **14
calendar days including today**: if today is 1 November, the last available date
is 14 November. The server and the calendar use the same rule
(`BookingRules.HORIZON_DAYS` served through `GET /api/host-settings`), and a
booking outside the window is rejected with a 409.

Seeded availability is **Mon-Fri 09:00-17:00** in the host timezone
`Europe/Berlin`; a slot lasts as long as the chosen booking type. Both values are
recorded in [`typespec/main.tsp`](typespec/main.tsp) and
[`docs/domain.md`](docs/domain.md).



## Deployment

The app runs on [Render](https://render.com) (free tier), and deploys **manually
only** — no service has auto-deploy enabled, and the deploy workflow has no push
or PR triggers:

| Resource | Render service | URL |
| --- | --- | --- |
| Frontend | static site `call-calendar` | https://call-calendar-es6x.onrender.com |
| Backend | web service `call-calendar-api` | https://call-calendar-api-55jr.onrender.com |
| Database | Postgres `call-calendar-db` (free) | internal, not exposed |

To deploy: push to the branch you want to ship, then run the
[`deploy`](.github/workflows/deploy.yml) workflow by hand (GitHub → Actions →
**deploy** → *Run workflow*), selecting that branch in the dropdown. The workflow
deploys exactly that branch's HEAD commit — it passes the checked-out
`git rev-parse HEAD` as Render's `commitId` — so the validated code and the
deployed code are always the same, regardless of which branch the services are
connected to. (The *Run workflow* button is only registered once the file exists
on the default branch, `dev`; both branches carry `deploy.yml`.) The workflow runs
the same `mise run check` gate CI runs, deploys the backend first and the static
site second, then verifies the live deployment (API ping, served index, CORS
preflight).

One-time setup: add a `RENDER_API_KEY` repository secret (Settings → Secrets and
variables → Actions) holding a Render API key with write access. The same key
sits in the gitignored `.env` (for local Render API scripting) and
`.render-api-key` (read by the `render` MCP server configured in
`opencode.json`); neither file is ever committed.

Free-tier caveats:

- Services spin down after ~15 minutes without traffic; the first request after
  idle takes 30–60 seconds to wake them.
- The free Postgres instance expires 30 days after creation (**2026-12-10**) and
  must then be recreated (data is not preserved).
- Render suffixes service URLs (`-es6x`, `-55jr`). If a service is recreated,
  update the URLs in `frontend/.env.production`, the
  `CORS_ALLOWED_ORIGINS` env var of the backend service, and
  `.github/workflows/deploy.yml`.
- The frontend's API URL is baked in at build time by the Vite mode
  (`frontend/.env.production` → `VITE_API_BASE_URL`); the backend's allowed origin
  comes from the `CORS_ALLOWED_ORIGINS` Render env var (defaulting to
  `http://localhost:5173` locally).
- The static site's build command and publish directory live in the Render
  dashboard, not in the repo: build with `npm ci && npm run build` in
  `frontend/` and publish `frontend/dist`.



## Testing

Tests are run automatically by Hexlet on every commit via the [`hexlet-check`](.github/workflows/hexlet-check.yml) GitHub Actions workflow. This repo's own [`ci.yml`](.github/workflows/ci.yml) additionally runs the full quality gate on every push.

The one command that runs everything (all linters, all unit and browser tests,
the OpenAPI spec lint, repo hygiene checks, and the generated-code freshness
gate). It needs Docker for the browser test:

```bash
mise run check
```

Other tasks:

```bash
mise run fix        # apply safe autofixes (spotless, eslint, stylelint, prettier)
mise run generate   # regenerate openapi/api.yml + the frontend API client
mise run smoke      # docker compose stack end-to-end check (needs Docker)
```

Git hooks (fast pre-commit tier + commit-msg lint) are managed by hk; once per
clone:

```bash
hk install --mise
```

There is deliberately **no pre-push hook**: run `mise run check` yourself before
calling a change done. CI runs the same command on every push.

The `dev` branch has a required-check ruleset: `check`, `smoke`, `verify-head`,
`lint` and `build`. `verify-head` checks out the exact PR head SHA and uploads
the Playwright trace plus that SHA as an Actions artifact, so the browser
evidence can be tied to the commit under review.

Prettier uses `endOfLine: "auto"` in `frontend/.prettierrc` so a Windows
checkout with `core.autocrlf=true` passes without reformatting every file. The
repository still stores LF; do not change this back to `lf` unless
`.gitattributes` forces LF for the frontend source at checkout.

Commits follow [Conventional Commits](https://www.conventionalcommits.org)
(enforced by commitlint in the commit-msg hook and in CI).

Run individual test suites locally:

```bash
cd backend && mise exec -- ./gradlew test   # JUnit 5 + Testcontainers PostgreSQL
cd frontend && mise exec -- npm test -- --run   # Vitest + Testing Library + MSW
```

The frontend never calls the API through hand-written URLs: the typed client in
`frontend/src/api/` is generated from `openapi/api.yml`, which is compiled
from the TypeSpec contract in `typespec/` with one command
(`mise run generate`) — see
[ADR-0008](docs/adr/0008-typespec-contract-source.md). The earlier code-first
pipeline is documented in the superseded
[ADR-0003](docs/adr/0003-openapi-code-first-ng-openapi-gen.md).

## AI agent

The repo runs the [OpenCode](https://opencode.ai) agent as a **GitHub App** (the
`anomalyco/opencode/github` action, pinned to a SHA) rather than a self-hosted
agent: the App is installed on the repository and the workflow exchanges a fresh
OIDC token for a short-lived App token, so the repo's own `GITHUB_TOKEN` stays
read-only. The alternative — a standalone agent daemon watching the repo — would
run outside GitHub Actions with its own long-lived credentials and scheduler;
the App keeps the trigger, the permissions and the run history inside the repo's
Actions tab instead.

The command workflow is
[`.github/workflows/opencode.yml`](.github/workflows/opencode.yml). It runs on
`issue_comment` and `pull_request_review_comment`, each limited to
`types: [created]`, and starts only when the repository owner comments `/oc` or
`/opencode` on an issue, a pull request, or a line of a pull request's diff.
Bot comments are ignored, and the workflow's own token cannot write. The model
is `opencode-go/deepseek-v4.1-flash`; the API key lives in the
`OPENCODE_API_KEY` repository secret. The run posts the agent's answer as a
comment (and, for a line comment, moves it into that line's thread).
A companion workflow,
[`.github/workflows/opencode-review.yml`](.github/workflows/opencode-review.yml),
reviews each non-draft PR authored by the owner or the agent bot; drafts,
forks, `release-please--` branches, dependabot and `agent-paused` PRs are
skipped. It runs on `pull_request` (`opened`, `synchronize`, `reopened`,
`ready_for_review`), declares `permissions: {}` and grants each job only the
scopes it needs: `preflight` reads contents and actions; `review` reads
contents, pull requests, issues, checks, statuses and actions and gets
`id-token: write` for the App-token exchange; `refuse` gets `issues: write`
to post its model-free comment; `report` reads contents and actions and gets
`issues: write` to inspect the failed step and post the report. The agent gets
a read-only `GH_TOKEN` and shell whitelist, and the review is posted through
the App token.
The jobs time out after 5 minutes
(`preflight`, `refuse`, `report`) or 15 minutes (`review`), and a per-PR
concurrency group cancels a review superseded by a new push. The review is
**advisory** — not a required check — and follows `REVIEW.md` plus
[docs/agents/review.md](docs/agents/review.md). A third,
[`.github/workflows/opencode-triage.yml`](.github/workflows/opencode-triage.yml),
triages each newly opened issue: it runs on `issues: [opened]`, skips bot
authors and any issue already carrying a triage state label, and asks the agent
to follow the triage skill (`.agents/skills/triage/`) — applying a
`bug`/`enhancement` category plus a state label and posting a triage comment.
Tickets produced by `/to-tickets` and `/to-spec` already carry `ready-for-agent`
and so pass through untouched.

Agent runs are guarded by three separate controls: a secret-free fork/pause
gate, the provider's account-wide quota (`GET https://opencode.ai/zen/go/v1/usage`)
and a per-PR attempt budget (`OPENCODE_RUN_BUDGET`, default 10, and
`OPENCODE_REVIEW_BUDGET`, default 20). A refused run skips the model and posts
the reason, head SHA and run link. `OPENCODE_DISABLED=true` stops new runs
globally and the `agent-paused` label stops them for one PR or issue. The
semantics, including why a re-run consumes another attempt and why
`timeout-minutes` is not a budget, are in
[docs/agents/agent-runs.md](docs/agents/agent-runs.md).

Session sharing is disabled where the action is used: the command workflow
runs the pinned action with `share: "false"`. The review and triage workflows
do not use the action at all — they run `opencode run` and print the answer to
stdout, so the action's default sharing path is never used. The skills and
GitHub Issues conventions the agent follows live in `.agents/skills/` and
`docs/agents/`; the repo-specific commands it may run are documented in
[AGENTS.md](AGENTS.md).

## Scheduled audits

Two workflows run an audit on a schedule and on demand. The repository's default
branch is `dev`, so that is the branch the schedules and the manual runs use.
Both jobs are bounded by `timeout-minutes` and a non-cancelling `concurrency`
group; neither can change code or open a pull request.

### TODO/FIXME audit

[`todo-fixme-audit.yml`](.github/workflows/todo-fixme-audit.yml) runs daily at
00:00 UTC+7 (17:00 UTC). It greps hand-written source for TODO, FIXME, HACK,
XXX and CHANGEME markers, cross-references them with existing issues (open and
closed). When the agent runs, it:

- saves the report, the agent log, the run URL and the context as the
  `todo-fixme-audit-<date>` artifact (90 days);
- posts a one-line run summary — finding count, filed issues and the run link —
  as a comment on the stable
  [Scheduled audit reports](https://github.com/crraay/ai-for-developers-project-387/issues?q=label%3Aaudit-report)
  issue, so the result stays visible after the artifact expires;
- files one `audit-finding` issue per untracked finding, with the problem, the
  proposed action, the app name (`Call Calendar`) and the run/report link;
- searches all issues before filing, so a repeat run with the same finding does
  not create a duplicate;
- accepts an optional `training_finding` input on a manual run. The agent files
  a `training`-labelled issue that says it is not a confirmed application
  defect, which exercises the issue-writing path without inventing a real bug.

The job asks for `contents: read` and `issues: write`; the `GITHUB_TOKEN` is
handed to the agent as `GH_TOKEN` (the `use_github_token` path), and the OpenCode
API key is read only by the quota preflight and the agent step. Reports live in
the gitignored `.audit/` directory and are never committed. A provider-refused
run records the refusal in the artifact and the job summary instead of calling
the agent.

Results:

| Run | Trigger | Result |
|---|---|---|
| [43715322557](https://github.com/crraay/ai-for-developers-project-387/actions/runs/43715322557) | `workflow_dispatch`, `dev`, 2026-11-15 | 0 markers; report artifact `todo-fixme-audit-2026-11-15` |
| [43988510547](https://github.com/crraay/ai-for-developers-project-387/actions/runs/43988510547) | `schedule`, `dev`, 2026-11-17 | 0 markers; report artifact `todo-fixme-audit-2026-11-17` |
| [44012048988](https://github.com/crraay/ai-for-developers-project-387/actions/runs/44012048988) | `workflow_dispatch` with a training finding, feature branch, 2026-11-17 | filed training issue [#61](https://github.com/crraay/ai-for-developers-project-387/issues/61); posted the run summary on [#60](https://github.com/crraay/ai-for-developers-project-387/issues/60) |
| [44016934095](https://github.com/crraay/ai-for-developers-project-387/actions/runs/44016934095) | `workflow_dispatch` with a fresh training finding, `dev`, 2026-11-17 | filed training issue [#68](https://github.com/crraay/ai-for-developers-project-387/issues/68); posted the run summary on [#60](https://github.com/crraay/ai-for-developers-project-387/issues/60) |
| [44017138574](https://github.com/crraay/ai-for-developers-project-387/actions/runs/44017138574) | the same training finding again, `dev`, 2026-11-17 | found #68, filed no duplicate; posted the run summary; 0 markers |

The training verification is deliberately not a defect in the app: the
`training_finding` input carries prepared text, and issues #61 and #68 are
labelled `training` with a body that says they are not confirmed application
defects. #61 was the first demo on the feature branch; #68 was created by the
`dev` run above, and the repeat `dev` run reused it. A real audit with no
markers creates no finding issue; it still posts the “0 markers” summary.

### OSV-Scanner audit

[`security.yml`](.github/workflows/security.yml) is the separate weekly lockfile
audit (Mondays 05:24 UTC). It saves the scanner Markdown, stderr and exit code
as an artifact, classifies the result as clean, findings, no-packages or
scanner-error, and on findings asks the agent to file one issue per untracked
vulnerable package after checking existing issues. The first findings run filed
[#28](https://github.com/crraay/ai-for-developers-project-387/issues/28) for the
`js-yaml` advisories; the 2026-11-16 scheduled run found the same three
advisories already tracked and created no duplicate.

### What I learned

- The schedule is the easy part; durable output is the hard part. An artifact
  expires and is invisible to the issue tracker, so the run needs a permanent
  comment and each finding needs a real issue.
- Deduplication has to include closed issues. A fixed finding would otherwise
  return as a brand-new task on the next run.
- A training input is a better demonstration than a fake defect: it proves the
  write path without polluting the backlog or asking a human to triage an
  invented bug.
- The narrow `issues: write` scope and the shell whitelist are enough for this
  loop. The agent does not need code or pull-request permissions to audit.

