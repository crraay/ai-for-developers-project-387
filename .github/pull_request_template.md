<!--
Fill every section. Write "n/a — <reason>" where a section genuinely does not
apply; do not delete the heading. The reviewer reads this body, the linked
spec/tickets and the links below.
-->

## Summary

<!-- The smallest view that makes the change clear: a tree, a diff sketch, a short call tree or a paragraph. -->

## Source and approval

- Source request:
- Spec:
- Tickets:
- Human approval:
- Out of scope:

<!-- Link the issue, spec and each ticket. Link the comment or document where the human approved the scope; if there is none, say so. -->

## What changed

<!-- Behaviour, not a file list. Call out generated files and any rule/lint exception. -->

## Checks

- [ ] `mise run check` (or the exact subset run) — command:
- [ ] Commit messages pass `mise run check:commits`
- [ ] Red/green evidence for a bug fix: the test fails on the base commit and passes after the fix
- [ ] For a new capability: the check fails without the new behaviour and passes with it
- [ ] Generated files regenerated with `mise run generate` and committed

| Check | Command / run link | Result |
|---|---|---|
|  |  |  |

**Verified SHA:** `<git rev-parse HEAD>` (must match the PR head this evidence was produced from)

<!-- Do not replace the log with "tests passed": link the run or paste the relevant tail. -->

## Risk

- What can break:
- Who is affected:
- Review depth (why this is enough):
- Data impact: <!-- Does a code revert also restore the data? If not, what does? -->

## Rollback

- Git:
- How to verify the behaviour is restored:
- Data-specific recovery (if any):

## Closes

Closes #

<!-- Add `Closes #N` for every ticket this PR closes; use `Refs #N` / `Part of #N` otherwise. -->
