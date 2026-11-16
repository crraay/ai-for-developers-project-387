/**
 * The only issue-edit command the triage agent may run.
 *
 * Usage: node scripts/agent-issue-edit.mjs <issue> --add-label <label[,label]>
 *
 * The script rejects every other flag, so short forms such as `-bPWNED` or
 * `-tPWNED` cannot rewrite the issue body or title. Labels are checked against
 * the triage vocabulary; the `gh` call is made with execFileSync, not a shell.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ALLOWED_LABELS = new Set([
  'bug',
  'enhancement',
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
]);

export const parseIssueEditArgs = (args) => {
  const [issue, ...rest] = args;
  if (!issue || !/^[1-9][0-9]*$/.test(issue)) {
    throw new Error('usage: <issue> --add-label <label[,label]>');
  }

  const labels = [];
  for (let index = 0; index < rest.length; index += 1) {
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

  if (labels.length === 0) throw new Error('at least one --add-label is required');
  return { issue, labels };
};

const main = () => {
  const { issue, labels } = parseIssueEditArgs(process.argv.slice(2));
  execFileSync(
    'gh',
    ['issue', 'edit', issue, '--add-label', labels.join(',')],
    { stdio: 'inherit', env: process.env },
  );
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
