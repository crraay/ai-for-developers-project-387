import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const workflowDir = new URL('../.github/workflows/', import.meta.url);

// These guards close the ways a whitelisted command can stop being the command
// the allow rule names: a pipe, command substitution, a background process, a
// newline that starts a second command, or a redirect. They must be present in
// every agent shell whitelist and must come after the allow rules, because the
// last matching permission wins.
const REQUIRED_GUARDS = ['*;*', '*&&*', '*&*', '*|*', '*$*', '*`*', '*>*', '*<*', '*\n*', '*\r*'];

const extractPermission = (file) => {
  const text = readFileSync(new URL(file, workflowDir), 'utf8');
  const marker = 'OPENCODE_PERMISSION: |';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;

  const lineStart = text.lastIndexOf('\n', markerIndex) + 1;
  const markerIndent = markerIndex - lineStart;
  const lines = text.slice(markerIndex + marker.length).split(/\r?\n/);
  const content = [];
  let contentIndent = null;

  for (const line of lines.slice(1)) {
    if (line.trim() === '') {
      content.push('');
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    if (indent <= markerIndent) break;
    if (contentIndent === null) contentIndent = indent;
    content.push(line.slice(contentIndent));
  }

  return { file, permission: JSON.parse(content.join('\n').trim()) };
};

const workflows = readdirSync(workflowDir)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .map(extractPermission)
  .filter(Boolean);

test('every workflow that runs the agent has a parseable permission block', () => {
  assert.deepEqual(
    workflows.map(({ file }) => file).sort(),
    [
      'opencode-review.yml',
      'opencode-triage.yml',
      'opencode.yml',
      'security.yml',
      'todo-fixme-audit.yml',
    ],
  );
});

for (const { file, permission } of workflows) {
  test(`${file}: bash is deny-by-default with metacharacter guards after the allow rules`, () => {
    const bash = permission.bash;
    assert.ok(bash, `${file}: has a bash permission map`);
    assert.equal(bash['*'], 'deny', `${file}: bash is deny-by-default`);

    const entries = Object.entries(bash);
    const lastAllow = entries.reduce(
      (last, [key, value], index) => (value === 'allow' ? index : last),
      -1,
    );
    assert.ok(lastAllow >= 0, `${file}: has at least one allow rule`);

    for (const guard of REQUIRED_GUARDS) {
      const index = entries.findIndex(([key]) => key === guard);
      assert.ok(index >= 0, `${file}: missing bash guard ${JSON.stringify(guard)}`);
      assert.equal(entries[index][1], 'deny', `${file}: ${JSON.stringify(guard)} must deny`);
      assert.ok(
        index > lastAllow,
        `${file}: ${JSON.stringify(guard)} must come after the last allow rule`,
      );
    }
  });
}

test('triage edits labels only through the validated script', () => {
  const triage = workflows.find(({ file }) => file === 'opencode-triage.yml');
  assert.ok(triage, 'triage permission block is present');
  const entries = Object.entries(triage.permission.bash);
  assert.ok(
    entries.some(
      ([key, value]) =>
        value === 'allow' && key === 'node scripts/agent-issue-edit.mjs *',
    ),
    'triage allows the validated label script',
  );
  assert.ok(
    !entries.some(
      ([key, value]) => value === 'allow' && key.startsWith('gh issue edit'),
    ),
    'triage does not allow raw gh issue edit',
  );
  assert.ok(
    !entries.some(
      ([key, value]) => value === 'allow' && key.startsWith('gh issue close'),
    ),
    'triage does not allow raw gh issue close',
  );
});
