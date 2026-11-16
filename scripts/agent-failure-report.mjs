/**
 * Classify a stopped OpenCode job and post the result without a model key.
 *
 * The workflow report job calls this script after the agent job finishes. The
 * script reads the job from the Actions API, derives a reason code from the
 * result, duration and failed step, and posts the reason, SHA, run link and
 * "needs human" status. It deliberately uses `execFileSync` so no shell is
 * involved in the API or comment calls.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const INFRA_STEPS = new Set([
  'Checkout repository',
  "Provide the local config's secret file placeholder",
  'Install the pinned toolchain',
  'Remember the newest PR comment',
  'Exchange App token for the agent',
  'Exchange a fresh App token for the thread reply',
  'Answer in the review thread',
  'Install opencode',
  'Exchange App token for the review',
  'Post the review',
]);

export const classifyFailure = ({
  result,
  durationSeconds,
  failedStep,
  timeoutMinutes,
}) => {
  if (result !== 'failure' && result !== 'cancelled') return null;
  if (result === 'cancelled') return 'timeout';
  if (
    Number.isFinite(durationSeconds) &&
    durationSeconds >= Number(timeoutMinutes) * 60 - 60
  ) {
    return 'timeout';
  }
  if (failedStep && INFRA_STEPS.has(failedStep)) return 'infra';
  return 'agent_failed';
};

export const jobDurationSeconds = (job) => {
  const started = Date.parse(job?.started_at ?? '');
  const completed = Date.parse(job?.completed_at ?? '');
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return 0;
  return Math.max(0, Math.round((completed - started) / 1000));
};

export const failedStepName = (job) =>
  job?.steps?.find((step) => step.conclusion === 'failure')?.name ?? '';

export const renderFailureBody = ({ title, reason, sha, runUrl }) => {
  const explanation =
    reason === 'timeout'
      ? 'The run was cancelled or exceeded its time budget. Check the last step in the log.'
      : reason === 'infra'
        ? 'A setup or transport step failed before the model could answer. Check the failed step and the toolchain.'
        : 'The agent step failed. Check the failed step and the model log; if the cause is unclear, treat it as agent_failed.';
  return [
    `**${title}**`,
    '',
    `- Reason code: \`${reason}\``,
    `- Commit: \`${sha}\``,
    `- Run: ${runUrl}`,
    '- **Status: needs human.** Do not retry automatically; inspect the log before choosing the next action.',
    '',
    explanation,
    '',
  ].join('\n');
};

const main = () => {
  const env = process.env;
  const required = [
    'REPO',
    'NUMBER',
    'SHA',
    'RUN_ID',
    'RESULT',
    'JOB_NAME',
    'TIMEOUT_MINUTES',
    'RUN_URL',
    'TITLE',
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`missing environment: ${missing.join(', ')}`);
  }

  const jobs = JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        `repos/${env.REPO}/actions/runs/${env.RUN_ID}/jobs?per_page=100`,
      ],
      { encoding: 'utf8', env },
    ),
  );
  const job = (jobs.jobs ?? []).find((entry) => entry.name === env.JOB_NAME);
  const reason = classifyFailure({
    result: env.RESULT,
    durationSeconds: jobDurationSeconds(job),
    failedStep: failedStepName(job),
    timeoutMinutes: Number(env.TIMEOUT_MINUTES),
  });

  if (!reason) {
    console.log('No failure to report.');
    return;
  }

  const body = renderFailureBody({
    title: env.TITLE,
    reason,
    sha: env.SHA,
    runUrl: env.RUN_URL,
  });
  const bodyFile = join(tmpdir(), `agent-failure-${process.pid}.md`);
  writeFileSync(bodyFile, body);
  execFileSync(
    'gh',
    ['issue', 'comment', env.NUMBER, '--repo', env.REPO, '--body-file', bodyFile],
    { encoding: 'utf8', env },
  );
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${env.TITLE}\n\n${body}\n`);
  }
  console.error(`::error::${reason}`);
  process.exitCode = 1;
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
