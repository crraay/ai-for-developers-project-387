import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  evaluateBudget,
  evaluateGate,
  evaluateProvider,
  fetchProviderUsage,
  firstCode,
  parseUsage,
  selectPriorAttempts,
} from './opencode-preflight.mjs';

const run = (overrides) => ({
  id: 1,
  display_title: 'opencode-command-pr-7-crraay',
  run_attempt: 1,
  conclusion: 'success',
  ...overrides,
});

test('a first attempt uses one slot and is allowed below the limit', () => {
  assert.deepEqual(
    evaluateBudget({ priorAttempts: 0, currentAttempt: 1, limit: 10 }),
    { allowed: true, used: 1, limit: 10, code: '', reason: '' },
  );
});

test('the tenth attempt fits and the eleventh is refused', () => {
  assert.equal(evaluateBudget({ priorAttempts: 9, currentAttempt: 1, limit: 10 }).allowed, true);
  const refused = evaluateBudget({ priorAttempts: 10, currentAttempt: 1, limit: 10 });
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /11 of 10 attempts used/);
});

test('refusals carry a reason code for the finalizer', () => {
  const exhausted = evaluateBudget({ priorAttempts: 10, currentAttempt: 1, limit: 10 });
  assert.equal(exhausted.code, 'limit_exhausted');
  const misconfigured = evaluateBudget({ priorAttempts: 0, currentAttempt: 1, limit: 0 });
  assert.equal(misconfigured.code, 'infra');
  assert.equal(evaluateBudget({ priorAttempts: 0, currentAttempt: 1, limit: 10 }).code, '');
});

test('multiple refusals keep one documented reason code', () => {
  assert.equal(firstCode('', 'provider_quota', 'limit_exhausted'), 'provider_quota');
  assert.equal(firstCode('limit_exhausted', 'provider_quota'), 'limit_exhausted');
  assert.equal(firstCode('', '', ''), '');
});

test('a re-run consumes another attempt', () => {
  const rerun = evaluateBudget({ priorAttempts: 0, currentAttempt: 2, limit: 10 });
  assert.equal(rerun.allowed, true);
  assert.equal(rerun.used, 2);

  const atLimit = evaluateBudget({ priorAttempts: 9, currentAttempt: 2, limit: 10 });
  assert.equal(atLimit.allowed, false);
  assert.equal(atLimit.used, 11);
});

test('a non-positive limit refuses instead of allowing everything', () => {
  const result = evaluateBudget({ priorAttempts: 0, currentAttempt: 1, limit: 0 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /positive limit/);
});

test('prior attempts sum every run attempt, including cancelled runs', () => {
  const runs = [
    run({ id: 1, run_attempt: 1, conclusion: 'success' }),
    run({ id: 2, run_attempt: 1, conclusion: 'cancelled' }),
    run({ id: 3, run_attempt: 3, conclusion: 'failure' }),
    run({ id: 4, run_attempt: 1, conclusion: 'skipped' }),
    run({ id: 5, display_title: 'another command' }),
  ];
  assert.equal(
    selectPriorAttempts(runs, {
      currentRunId: 99,
      key: 'opencode-command-pr-7-crraay',
    }),
    5,
  );
});

test('the current run is excluded so its run_attempt is counted once', () => {
  const runs = [
    run({ id: 1, run_attempt: 1 }),
    run({ id: 2, run_attempt: 2 }),
  ];
  assert.equal(
    selectPriorAttempts(runs, {
      currentRunId: 2,
      key: 'opencode-command-pr-7-crraay',
    }),
    1,
  );
});

test('skipped runs can be counted when a workflow asks for them', () => {
  const runs = [run({ id: 1, conclusion: 'skipped' })];
  assert.equal(
    selectPriorAttempts(runs, {
      currentRunId: 99,
      key: 'opencode-command-pr-7-crraay',
    }),
    0,
  );
  assert.equal(
    selectPriorAttempts(runs, {
      currentRunId: 99,
      key: 'opencode-command-pr-7-crraay',
      includeSkipped: true,
    }),
    1,
  );
});

test('provider usage parses the three windows', () => {
  const windows = parseUsage({
    usage: {
      rolling: { status: 'ok', percent: 10, resetsAt: '2026-11-16T12:00:00Z' },
      weekly: { status: 'ok', percent: 20 },
      monthly: { status: 'ok', percent: 30 },
    },
  });
  assert.deepEqual(windows.map((window) => window.name), ['rolling', 'weekly', 'monthly']);
  assert.equal(windows[0].percent, 10);
  assert.equal(windows[0].resetsAt, '2026-11-16T12:00:00Z');
});

test('an unknown provider status is treated as rate-limited', () => {
  const windows = parseUsage({
    usage: { rolling: { status: 'something-new', percent: 1 } },
  });
  assert.equal(windows[0].status, 'rate-limited');
  assert.equal(evaluateProvider(windows, 95).allowed, false);
});

test('provider quota refuses a rate-limited window', () => {
  const windows = parseUsage({
    usage: {
      rolling: { status: 'rate-limited', percent: 100 },
      weekly: { status: 'ok', percent: 20 },
      monthly: { status: 'ok', percent: 30 },
    },
  });
  const result = evaluateProvider(windows, 95);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'provider_quota');
  assert.match(result.reason, /provider quota exhausted/);
  assert.match(result.reason, /5h 100% \(rate-limited\)/);
});

test('provider quota refuses a window at the threshold', () => {
  const windows = parseUsage({
    usage: {
      rolling: { status: 'ok', percent: 95 },
      weekly: { status: 'ok', percent: 20 },
    },
  });
  const result = evaluateProvider(windows, 95);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /threshold 95%/);
  assert.match(result.reason, /5h 95%/);
});

test('provider quota allows windows below the threshold', () => {
  const windows = parseUsage({
    usage: {
      rolling: { status: 'ok', percent: 94 },
      weekly: { status: 'ok', percent: 20 },
    },
  });
  assert.equal(evaluateProvider(windows, 95).allowed, true);
});

test('gate allows only a same-repository pull request and carries its head SHA', () => {
  assert.deepEqual(
    evaluateGate({ headRepo: 'crraay/repo', repo: 'crraay/repo', sha: 'abc123' }),
    { allowed: true, code: '', reason: '', sha: 'abc123' },
  );
  const fork = evaluateGate({ headRepo: 'someone/repo', repo: 'crraay/repo', sha: 'def456' });
  assert.equal(fork.allowed, false);
  assert.equal(fork.code, 'fork');
  assert.match(fork.reason, /fork pull requests/);
  assert.equal(fork.sha, 'def456');
  const missing = evaluateGate({ headRepo: null, repo: 'crraay/repo', sha: '' });
  assert.equal(missing.allowed, false);
  assert.equal(missing.code, 'infra');
});

const withServer = async (handler, run) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}/usage`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('provider HTTP 200 is parsed and the bearer key is sent', async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.headers.authorization, 'Bearer test-key');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          usage: { rolling: { status: 'ok', percent: 10 }, monthly: { status: 'ok', percent: 20 } },
        }),
      );
    },
    async (url) => {
      const result = await fetchProviderUsage('test-key', url);
      assert.equal(result.ok, true);
      assert.equal(evaluateProvider(result.windows, 95).allowed, true);
    },
  );
});

test('provider HTTP errors are refusals with a readable reason', async () => {
  await withServer(
    (request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'rate limited' } }));
    },
    async (url) => {
      const result = await fetchProviderUsage('test-key', url);
      assert.equal(result.ok, false);
      assert.match(result.reason, /HTTP 429/);
      assert.match(result.reason, /rate limited/);
    },
  );
});

test('provider 200 without usage data is a refusal', async () => {
  await withServer(
    (request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    },
    async (url) => {
      const result = await fetchProviderUsage('test-key', url);
      assert.equal(result.ok, false);
      assert.match(result.reason, /no usage data/);
    },
  );
});

const workflowText = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

const assertBudgetKeyMatchesRunName = (name) => {
  const text = workflowText(name);
  const runName = text.match(/^run-name: (".*")$/m)?.[1];
  const budgetKey = text.match(/^\s+BUDGET_KEY: (".*")$/m)?.[1];
  assert.ok(runName, `${name} has a run-name`);
  assert.ok(budgetKey, `${name} passes BUDGET_KEY`);
  assert.equal(budgetKey, runName, `${name}: run-name and BUDGET_KEY must match`);
};

test('the /oc budget key is the run-name', () => {
  assertBudgetKeyMatchesRunName('opencode.yml');
});

test('the review budget key is the run-name', () => {
  assertBudgetKeyMatchesRunName('opencode-review.yml');
});
