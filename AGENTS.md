# AGENTS.md

Guidance for agents working in this repo. See [README.md](README.md) for what the kit
does and [docs/adr/](docs/adr/) for why it is shaped this way.

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
