import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-commits.mjs', import.meta.url));

function newRepo(t, { withBase = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-commits-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Check Commits Test'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'check-commits@example.com'], { cwd: dir });
  writeFileSync(join(dir, 'seed.txt'), 'seed');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'chore: seed'], { cwd: dir });
  if (withBase) {
    execFileSync('git', ['update-ref', 'refs/remotes/origin/dev', 'HEAD'], { cwd: dir });
  }
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_BASE_REF: '', DEFAULT_BRANCH: '' },
  });
}

function commit(dir, file, parts) {
  writeFileSync(join(dir, file), file);
  execFileSync('git', ['add', '.'], { cwd: dir });
  const args = ['commit', '-q'];
  for (const part of parts) {
    args.push('-m', part);
  }
  execFileSync('git', args, { cwd: dir });
}

test('skips when there are no commits ahead of the base', (t) => {
  const result = run(newRepo(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /no commits ahead/);
});

test('skips when the base ref is unavailable', (t) => {
  const result = run(newRepo(t, { withBase: false }));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /not available; skipping/);
});

test('fails a commit whose body line is longer than 100 characters', (t) => {
  const dir = newRepo(t);
  commit(dir, 'long.txt', ['feat: add a long body', 'A body line that is far too long '.repeat(4)]);

  const result = run(dir);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /body-max-line-length/);
});

test('passes a conventional commit with a wrapped body and a footer', (t) => {
  const dir = newRepo(t);
  commit(dir, 'good.txt', [
    'feat: add a conventional commit',
    'Explain the change in a body line that stays inside the limit.',
    'Refs #55',
  ]);

  const result = run(dir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /linting 1 commit/);
});
