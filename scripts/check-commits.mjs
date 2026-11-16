/**
 * Lint the commit messages of the commits ahead of the base branch. `mise run
 * check` calls this so the gate that a change is "done" covers the same
 * Conventional Commits rules as CI; the `hk` commit-msg hook is a per-clone
 * install and was missing on the agent runner (issue #55).
 *
 * The base ref is `GITHUB_BASE_REF` on a pull request, `DEFAULT_BRANCH` when CI
 * passes it, otherwise `origin/dev` (this repo's default), then `origin/main`,
 * then `origin/HEAD`. A shallow checkout without the base ref skips instead of
 * failing: there is no range to lint.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd();

function git(args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function baseRef() {
  const explicit = process.env.GITHUB_BASE_REF || process.env.DEFAULT_BRANCH;
  if (explicit) return `origin/${explicit}`;
  for (const candidate of ['origin/dev', 'origin/main']) {
    if (refExists(candidate)) return candidate;
  }
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  } catch {
    return 'origin/dev';
  }
}

const base = baseRef();
if (!refExists(base)) {
  console.log(`check:commits: base ref ${base} is not available; skipping.`);
  process.exit(0);
}

const count = Number(git(['rev-list', '--count', `${base}..HEAD`]));
if (count === 0) {
  console.log(`check:commits: no commits ahead of ${base}; skipping.`);
  process.exit(0);
}

const config = process.env.COMMITLINT_CONFIG || join(repoRoot, 'commitlint.config.mjs');
const cli =
  process.env.COMMITLINT_CLI || join(repoRoot, 'node_modules', '@commitlint', 'cli', 'cli.js');
if (!existsSync(cli)) {
  console.error(`check:commits: commitlint is not installed at ${cli}; run \`mise run setup\`.`);
  process.exit(1);
}

console.log(`check:commits: linting ${count} commit(s) in ${base}..HEAD`);
try {
  execFileSync(process.execPath, [cli, '--config', config, '--from', base, '--to', 'HEAD'], {
    cwd,
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
