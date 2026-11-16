import assert from 'node:assert/strict';
import test from 'node:test';

import { parseIssueEditArgs, validateIssueNumber } from './agent-issue-edit.mjs';

test('a valid label command is parsed', () => {
  assert.deepEqual(parseIssueEditArgs(['7', '--add-label', 'bug,needs-triage']), {
    issue: '7',
    labels: ['bug', 'needs-triage'],
    close: false,
  });
  assert.deepEqual(
    parseIssueEditArgs(['42', '--add-label', 'enhancement', '--add-label', 'needs-info']),
    { issue: '42', labels: ['enhancement', 'needs-info'], close: false },
  );
});

test('a valid close command is parsed', () => {
  assert.deepEqual(parseIssueEditArgs(['7', '--close']), {
    issue: '7',
    labels: [],
    close: true,
  });
  assert.deepEqual(parseIssueEditArgs(['7', '--add-label', 'bug,wontfix', '--close']), {
    issue: '7',
    labels: ['bug', 'wontfix'],
    close: true,
  });
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

test('long body/title flags, promotion labels and unknown labels are rejected', () => {
  assert.throws(
    () => parseIssueEditArgs(['7', '--add-label', 'bug', '--body', 'new']),
    /unsupported argument/,
  );
  assert.throws(
    () => parseIssueEditArgs(['7', '--add-label', 'bug', '--title', 'new']),
    /unsupported argument/,
  );
  for (const label of ['ready-for-agent', 'ready-for-human', 'not-a-triage-label']) {
    assert.throws(
      () => parseIssueEditArgs(['7', '--add-label', label]),
      /not in the triage vocabulary/,
      label,
    );
  }
  assert.throws(() => parseIssueEditArgs(['7', '--add-label', 'bug,']), /empty label/);
});

test('an issue number and at least one action are required', () => {
  assert.throws(() => parseIssueEditArgs([]), /usage/);
  assert.throws(() => parseIssueEditArgs(['abc', '--add-label', 'bug']), /usage/);
  assert.throws(() => parseIssueEditArgs(['7']), /at least one/);
  assert.throws(() => parseIssueEditArgs(['7', '--add-label']), /needs a value/);
  assert.throws(() => parseIssueEditArgs(['7', '--close', '--close']), /repeated/);
});

test('the issue must match the event issue', () => {
  assert.doesNotThrow(() => validateIssueNumber('7', '7'));
  assert.doesNotThrow(() => validateIssueNumber(7, '7'));
  assert.throws(() => validateIssueNumber('8', '7'), /not the event issue/);
  assert.throws(() => validateIssueNumber('7', ''), /ISSUE_NUMBER is not set/);
});
