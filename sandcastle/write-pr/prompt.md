# TASK

Write the title and description for a pull request that closes issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}.

The implementation is already done — commits sit on branch
`{{BRANCH}}`. You are NOT implementing anything. You are NOT running
tests. You are summarising work that already exists.

# CONTEXT

Read the issue:

```
gh issue view {{ISSUE_NUMBER}} --comments
```

Read what changed on the branch:

```
git log {{BASE_BRANCH}}..{{BRANCH}} --reverse
git diff {{BASE_BRANCH}}..{{BRANCH}} --stat
git diff {{BASE_BRANCH}}..{{BRANCH}}
```

If the diff is large, focus on the commit messages and the `--stat`
summary; only `git diff` specific files when a commit message is
unclear.

# OUTPUT

Emit a single block as the last thing in your response:

<output>
{
  "prTitle": "feat: short imperative summary",
  "prDescription": "## Summary\n\n- bullet 1\n- bullet 2\n\nCloses #{{ISSUE_NUMBER}}"
}
</output>

- `prTitle` must be a single line, under 70 characters, and say in plain words what changed — `refactor: tenancy seam` names no outcome; `One tested tenancy module replaces 30 copied checks` does. A conventional-commit prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`) is fine when it is not the only content.
- `prDescription` must follow the house PR format. Read `.claude/skills/writing-prs/SKILL.md` before writing — it is the full spec. In short: an `## In plain English` section for the non-technical owner, a `## What to check before merging` list of things they can confirm in the app, then the complete technical write-up inside a `<details>` block. Nothing is summarised away to fit the fold.
- `prDescription` must include `Closes #{{ISSUE_NUMBER}}` so the PR closes the issue on merge.
