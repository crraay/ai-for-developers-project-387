/**
 * Preflight for the OpenCode agent workflows.
 *
 * Three separate controls meet here, and they are deliberately not the same
 * thing:
 *
 *   gate     - may this event reach a job that holds OPENCODE_API_KEY at all?
 *              (same-repository PR; the caller checks owner/command/pause)
 *   provider - has the model provider's own account-wide quota run out?
 *   budget   - how many attempts has this pull request already spent?
 *
 * The budget counts attempts, not workflow runs. A re-run keeps `run_id` and
 * increments `run_attempt`, so a run-id counter would let a timed-out run be
 * re-run without limit. A cancelled attempt stays in `run_attempt`, so a
 * cancellation is not a refund. `timeout-minutes` only bounds one attempt and
 * is not a substitute for the budget.
 *
 * The script writes GitHub Actions outputs and always exits 0 for an ordinary
 * deny, so the caller can post the reason instead of losing it to a red step.
 * Unexpected errors are also reported as a deny with the error text.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
export const DEFAULT_QUOTA_PERCENT = 95;
const WINDOW_ORDER = ['rolling', 'weekly', 'monthly'];
const WINDOW_LABEL = { rolling: '5h', weekly: '7d', monthly: '30d' };

const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const nonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
};

// One reason code, not a comma-joined list: gate -> provider -> budget order.
// The full reason text still carries every failed check.
export const firstCode = (...codes) => codes.find(Boolean) ?? '';

/**
 * Sum the attempts of earlier matching runs.
 *
 * `includeSkipped` is false for the review workflow, where a draft/ fork run
 * is skipped before the model and should not consume a review slot. The /oc
 * workflow encodes the command and commenter in `display_title`, so its
 * matching runs are already the real commands.
 */
export function selectPriorAttempts(
  runs,
  { currentRunId, key, includeSkipped = false },
) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => Number(run?.id) !== Number(currentRunId))
    .filter((run) => run?.display_title === key)
    .filter((run) => includeSkipped || run?.conclusion !== 'skipped')
    .reduce((total, run) => total + positiveInteger(run?.run_attempt, 1), 0);
}

/**
 * `used` counts every attempt, including the current one and its re-runs.
 * A first attempt with 0 earlier attempts uses 1; a re-run (attempt 2) uses
 * the earlier attempt as well, so the same run can consume more than one slot.
 */
export function evaluateBudget({ priorAttempts, currentAttempt, limit }) {
  const used = nonNegativeInteger(priorAttempts) + positiveInteger(currentAttempt, 1);
  const safeLimit = positiveInteger(limit, 0);
  const allowed = safeLimit > 0 && used <= safeLimit;
  return {
    allowed,
    used,
    limit: safeLimit,
    code: allowed ? '' : safeLimit === 0 ? 'infra' : 'limit_exhausted',
    reason:
      allowed
        ? ''
        : safeLimit === 0
          ? 'per-PR run budget is not configured with a positive limit'
          : `per-PR run budget exhausted: ${used} of ${safeLimit} attempts used`,
  };
}

export function parseUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const windows = [];
  for (const name of WINDOW_ORDER) {
    const raw = usage[name];
    if (!raw || typeof raw !== 'object') continue;
    const percent = Number(raw.percent);
    windows.push({
      name,
      // Only the documented `ok` state is safe. An unknown state is treated as
      // limited so a provider response change cannot silently allow a run.
      status: raw.status === 'ok' ? 'ok' : 'rate-limited',
      percent: Number.isFinite(percent) ? percent : 100,
      resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
    });
  }
  return windows.length > 0 ? windows : null;
}

export function formatUsage(windows) {
  return windows
    .map(
      (window) =>
        `${WINDOW_LABEL[window.name] ?? window.name} ${window.percent}%${
          window.status === 'rate-limited' ? ' (rate-limited)' : ''
        }`,
    )
    .join(', ');
}

export function evaluateProvider(windows, threshold = DEFAULT_QUOTA_PERCENT) {
  const safeThreshold = Math.min(100, Math.max(1, positiveInteger(threshold, DEFAULT_QUOTA_PERCENT)));
  if (!Array.isArray(windows) || windows.length === 0) {
    return {
      allowed: false,
      code: 'provider_quota',
      reason: 'provider quota check returned no usage windows',
    };
  }
  const limited = windows.filter((window) => window.status === 'rate-limited');
  if (limited.length > 0) {
    return {
      allowed: false,
      code: 'provider_quota',
      reason: `provider quota exhausted: ${formatUsage(windows)}`,
    };
  }
  const over = windows.filter((window) => window.percent >= safeThreshold);
  if (over.length > 0) {
    return {
      allowed: false,
      code: 'provider_quota',
      reason: `provider quota near its limit (threshold ${safeThreshold}%): ${formatUsage(windows)}`,
    };
  }
  return { allowed: true, code: '', reason: '' };
}

export function evaluateGate({ headRepo, repo, sha }) {
  if (!headRepo) {
    return {
      allowed: false,
      code: 'infra',
      reason: 'pull request head repository is unavailable (deleted fork?)',
      sha: sha ?? '',
    };
  }
  if (headRepo !== repo) {
    return {
      allowed: false,
      code: 'fork',
      reason: `/oc is disabled on fork pull requests (head ${headRepo}); push the branch to ${repo}`,
      sha: sha ?? '',
    };
  }
  return { allowed: true, code: '', reason: '', sha: sha ?? '' };
}

const ghJson = (args, env) => {
  const output = execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output);
};

export const fetchProviderUsage = async (apiKey, url, timeoutMs = 10_000) => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status is the useful part when the body is not JSON.
  }
  if (!response.ok) {
    const detail =
      typeof payload?.error?.message === 'string' ? `: ${payload.error.message.slice(0, 200)}` : '';
    return {
      ok: false,
      reason: `provider quota check failed: HTTP ${response.status}${detail}`,
    };
  }
  const windows = parseUsage(payload);
  if (!windows) {
    return { ok: false, reason: 'provider quota check returned no usage data' };
  }
  return { ok: true, windows };
};

const runGate = (env) => {
  if (env.IS_PR !== 'true') {
    return { allowed: true, code: '', reason: '', sha: env.DEFAULT_SHA ?? '' };
  }
  const pullRequest = ghJson(
    [`repos/${env.REPO}/pulls/${env.PR_NUMBER}`],
    { ...process.env, GH_TOKEN: env.GH_TOKEN },
  );
  return evaluateGate({
    headRepo: pullRequest?.head?.repo?.full_name,
    repo: env.REPO,
    sha: pullRequest?.head?.sha,
  });
};

const runProvider = async (env) => {
  if (!env.OPENCODE_API_KEY) {
    return {
      allowed: false,
      code: 'infra',
      reason: 'OPENCODE_API_KEY is not set',
      quota: '',
    };
  }
  const result = await fetchProviderUsage(
    env.OPENCODE_API_KEY,
    env.USAGE_URL || DEFAULT_USAGE_URL,
  );
  if (!result.ok) {
    return { allowed: false, code: 'infra', reason: result.reason, quota: '' };
  }
  const evaluation = evaluateProvider(result.windows, env.QUOTA_PERCENT);
  return {
    allowed: evaluation.allowed,
    code: evaluation.code,
    reason: evaluation.reason,
    quota: formatUsage(result.windows),
  };
};

const runBudget = (env) => {
  const limit = positiveInteger(env.BUDGET_LIMIT, 0);
  const currentRunId = Number(env.GITHUB_RUN_ID);
  const currentAttempt = positiveInteger(env.GITHUB_RUN_ATTEMPT, 1);
  if (!env.BUDGET_KEY || !Number.isInteger(currentRunId) || currentRunId <= 0) {
    return {
      allowed: false,
      code: 'infra',
      reason: 'run budget is missing its key or run id',
      used: '',
      limit,
    };
  }
  const pages = ghJson(
    [
      '--paginate',
      '--slurp',
      `repos/${env.REPO}/actions/workflows/${env.BUDGET_WORKFLOW}/runs?per_page=100`,
    ],
    { ...process.env, GH_TOKEN: env.GH_TOKEN },
  );
  const runs = (Array.isArray(pages) ? pages : [pages]).flatMap(
    (page) => page?.workflow_runs ?? [],
  );
  const prior = selectPriorAttempts(runs, {
    currentRunId,
    key: env.BUDGET_KEY,
    includeSkipped: env.BUDGET_INCLUDE_SKIPPED === 'true',
  });
  const evaluation = evaluateBudget({ priorAttempts: prior, currentAttempt, limit });
  return {
    allowed: evaluation.allowed,
    code: evaluation.code,
    reason: evaluation.reason,
    used: evaluation.used,
    limit: evaluation.limit,
  };
};

const writeOutputs = (result) => {
  const values = {
    allowed: String(result.allowed === true),
    code: String(result.code ?? '').replaceAll('\n', ' '),
    reason: String(result.reason ?? '').replaceAll('\n', ' '),
    sha: String(result.sha ?? '').replaceAll('\n', ' '),
    used: String(result.used ?? ''),
    limit: String(result.limit ?? ''),
    quota: String(result.quota ?? '').replaceAll('\n', ' '),
  };
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  } else {
    console.log(lines);
  }
  console.log(
    result.allowed === true
      ? 'opencode preflight: allowed'
      : `opencode preflight: stopped (${result.reason || 'no reason'})`,
  );
};

const main = async () => {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--gate')
    ? 'gate'
    : args.has('--provider')
      ? 'provider'
      : args.has('--budget')
        ? 'budget'
        : 'both';
  const env = process.env;
  const result = { allowed: true, code: '', reason: '', sha: env.HEAD_SHA ?? '' };

  if (mode === 'gate' || mode === 'both') {
    const gate = runGate(env);
    result.allowed = gate.allowed;
    result.code = firstCode(result.code, gate.code);
    result.reason = gate.reason;
    result.sha = gate.sha;
  }

  if (mode === 'provider' || mode === 'both') {
    const provider = await runProvider(env);
    if (!provider.allowed) {
      result.allowed = false;
      result.code = firstCode(result.code, provider.code);
      result.reason = [result.reason, provider.reason].filter(Boolean).join('; ');
    }
    result.quota = provider.quota;
  }

  if (mode === 'budget' || mode === 'both') {
    const budget = runBudget(env);
    if (!budget.allowed) {
      result.allowed = false;
      result.code = firstCode(result.code, budget.code);
      result.reason = [result.reason, budget.reason].filter(Boolean).join('; ');
    }
    result.used = budget.used;
    result.limit = budget.limit;
  }

  writeOutputs(result);
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    writeOutputs({
      allowed: false,
      code: 'infra',
      reason: `preflight failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
}
