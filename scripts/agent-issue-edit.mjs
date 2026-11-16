/**
 * The only issue write the triage agent may make.
 *
 * Usage:
 *   node scripts/agent-issue-edit.mjs <issue> --add-label <label[,label]> [--close]
 *   node scripts/agent-issue-edit.mjs <issue> --close
 *
 * The script rejects every other flag, so short forms such as `-bPWNED` or
 * `-tPWNED` cannot rewrite the issue body or title. It also binds the issue
 * number to the event's ISSUE_NUMBER, so a prompt-injected issue cannot label
 * or close an unrelated issue. Labels are checked against the triage
 * vocabulary; promotion labels are deliberately absent because only a human
 * may move an issue to `ready-for-agent` or `ready-for-human`.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ALLOWED_LABELS = new Set([
  'bug',
  'enhancement',
  'needs-triage',
  'needs-info',
  'wontfix',
]);

export const validateIssueNumber = (issue, expectedIssue) => {
  if (!expectedIssue) {
    throw new Error('ISSUE_NUMBER is not set; refusing an unbound issue write');
  }
  if (String(issue) !== String(expectedIssue)) {
    throw new Error(`issue ${issue} is not the event issue ${expectedIssue}`);
  }
};

export const parseIssueEditArgs = (args) => {
  const [issue, ...rest] = args;
  if (!issue || !/^[1-9][0-9]*$/.test(issue)) {
    throw new Error('usage: <issue> --add-label <label[,label]> [--close]');
  }

  const labels = [];
  let close = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--close') {
      if (close) throw new Error('--close is repeated');
      close = true;
      continue;
    }
    if (rest[index] !== '--add-label') {
      throw new Error(`unsupported argument: ${rest[index]}`);
    }
    const value = rest[index + 1];
    if (!value) throw new Error('--add-label needs a value');
    for (const label of value.split(',')) {
      const trimmed = label.trim();
      if (!trimmed) throw new Error('empty label');
      if (!ALLOWED_LABELS.has(trimmed)) {
        throw new Error(`label is not in the triage vocabulary: ${trimmed}`);
      }
      labels.push(trimmed);
    }
    index += 1;
  }

  if (!close && labels.length === 0) {
    throw new Error('at least one --add-label or --close is required');
  }
  return { issue, labels, close };
};

const main = () => {
  const parsed = parseIssueEditArgs(process.argv.slice(2));
  validateIssueNumber(parsed.issue, process.env.ISSUE_NUMBER);

  if (parsed.labels.length > 0) {
    execFileSync(
      'gh',
      ['issue', 'edit', parsed.issue, '--add-label', parsed.labels.join(',')],
      { stdio: 'inherit', env: process.env },
    );
  }
  if (parsed.close) {
    execFileSync('gh', ['issue', 'close', parsed.issue], {
      stdio: 'inherit',
      env: process.env,
    });
  }
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
