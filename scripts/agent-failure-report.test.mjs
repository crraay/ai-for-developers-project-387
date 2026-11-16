import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyFailure,
  failedStepName,
  jobDurationSeconds,
  renderFailureBody,
} from './agent-failure-report.mjs';

test('a cancelled job is not reported as a timeout', () => {
  assert.equal(
    classifyFailure({
      result: 'cancelled',
      durationSeconds: 10,
      failedStep: 'Run OpenCode',
      timeoutMinutes: 45,
    }),
    null,
  );
});

test('a job that ran to its time limit is a timeout even when it ends failed', () => {
  assert.equal(
    classifyFailure({
      result: 'failure',
      durationSeconds: 44 * 60,
      failedStep: 'Run OpenCode',
      timeoutMinutes: 45,
    }),
    'timeout',
  );
});

test('a failed setup step is infra', () => {
  assert.equal(
    classifyFailure({
      result: 'failure',
      durationSeconds: 120,
      failedStep: 'Install the pinned toolchain',
      timeoutMinutes: 45,
    }),
    'infra',
  );
});

test('a failed agent step is agent_failed', () => {
  assert.equal(
    classifyFailure({
      result: 'failure',
      durationSeconds: 120,
      failedStep: 'Run OpenCode',
      timeoutMinutes: 45,
    }),
    'agent_failed',
  );
});

test('success and skipped runs have no failure reason', () => {
  assert.equal(
    classifyFailure({
      result: 'success',
      durationSeconds: 120,
      failedStep: '',
      timeoutMinutes: 45,
    }),
    null,
  );
  assert.equal(
    classifyFailure({
      result: 'skipped',
      durationSeconds: 0,
      failedStep: '',
      timeoutMinutes: 45,
    }),
    null,
  );
});

test('job duration and failed step are read from the Actions payload', () => {
  const job = {
    started_at: '2026-11-16T08:00:00Z',
    completed_at: '2026-11-16T08:02:30Z',
    steps: [
      { name: 'Checkout repository', conclusion: 'success' },
      { name: 'Run OpenCode', conclusion: 'failure' },
    ],
  };
  assert.equal(jobDurationSeconds(job), 150);
  assert.equal(failedStepName(job), 'Run OpenCode');
  assert.equal(jobDurationSeconds({}), 0);
  assert.equal(failedStepName({}), '');
});

test('the report body carries the reason, SHA, run link and human status', () => {
  const body = renderFailureBody({
    title: 'OpenCode failed after the preflight passed.',
    reason: 'agent_failed',
    sha: 'abc123',
    runUrl: 'https://example.test/run/1',
  });
  assert.match(body, /Reason code: `agent_failed`/);
  assert.match(body, /Commit: `abc123`/);
  assert.match(body, /https:\/\/example\.test\/run\/1/);
  assert.match(body, /Status: needs human/);
});
