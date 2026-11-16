import assert from 'node:assert/strict';
import test from 'node:test';

import { parseIssueEditArgs } from './agent-issue-edit.mjs';

test('a valid label command is parsed', () => {
  assert.deepEqual(
    parseIssueEditArgs(['7', '--add-label', 'bug,needs-triage']),
    { issue: '7', labels: ['bug', 'needs-triage'] },
  );
  assert.deepEqual(
    parseIssueEditArgs(['42', '--add-label', 'enhancement', '--add-label', 'needs-info']),
    { issue: '42', labels: ['enhancement', 'needs-info'] },
  );
});

test('attached short flags are rejected, not treated as labels', () => {
  for (const flag of ['-bPWNED', '-FPWNED', '-tPWNED', '-mPWNED']) {
    assert.throws(
      () => parseIssueEditArgs(['7', '--add-label', 'bug', flag]),
      /unsupported argument/,
      flag,
    );
    assert.throws(() => parseIssueEditArgs(['7', flag]), /unsupported argument/, flag);
  }
});

test('long body/title flags and unknown labels are rejected', () => {
  assert.throws(
    () => parseIssueEditArgs(['7', '--add-label', 'bug', '--body', 'new']),
    /unsupported argument/,
  );
  assert.throws(
    () => parseIssueEditArgs(['7', '--add-label', 'bug', '--title', 'new']),
    /unsupported argument/,
  );
  assert.throws(
    () => parseIssueEditArgs(['7', '--add-label', 'not-a-triage-label']),
    /not in the triage vocabulary/,
  );
  assert.throws(() => parseIssueEditArgs(['7', '--add-label', 'bug,']), /empty label/);
});

test('an issue number and at least one label are required', () => {
  assert.throws(() => parseIssueEditArgs([]), /usage/);
  assert.throws(() => parseIssueEditArgs(['abc', '--add-label', 'bug']), /usage/);
  assert.throws(() => parseIssueEditArgs(['7']), /at least one/);
  assert.throws(() => parseIssueEditArgs(['7', '--add-label']), /needs a value/);
});
