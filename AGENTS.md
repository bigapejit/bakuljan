# AGENTS.md

Guidance for agents working in this repo. See [README.md](README.md) for what the kit
does and [docs/adr/](docs/adr/) for why it is shaped this way.

## The harness

`sandcastle/` holds the agent scripts and prompts that the five `agent-*.yml`
workflows run — implement, implement-prd, implement-pr, review, update-branch,
plus the two that write PR bodies. They run against the *caller's* repo from a
checkout of this one, so nothing in them may assume anything about a particular
app: the one per-repo thing is `{{REPO_CONTEXT}}`, filled from that repo's
`.sandcastle/context.md`. See
[ADR-0002](docs/adr/0002-the-harness-is-kit-code-repos-keep-a-context-paragraph.md).

`npm test` and `npm run typecheck` cover it. There is no CI here to run them for
you — run both before pushing, because `main` is live for two repos.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `bigapejit/bakuljan`, driven by the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to identically-named labels: `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the root (when it exists) plus `docs/adr/`. See
`docs/agents/domain.md`.
