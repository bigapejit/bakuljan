# bakuljan

Reusable CI for agent-driven Expo/Convex repos: the label-an-issue-get-a-PR loop,
and the scan-a-QR-to-review loop, defined once and called from every app repo.

This repo is **public and holds no secrets, ever**. Reusable workflows run in the
*caller's* context, so a private app repo passes `secrets: inherit` and its own
`CLAUDE_CODE_OAUTH_TOKEN`, `EXPO_TOKEN`, `AGENT_PAT` and friends never leave it.
Public is also the only shape that works without a GitHub organization: a private
repo cannot be called from another private repo on a personal account.

Callers reference `@main`. See [ADR-0001](docs/adr/0001-ci-is-a-kit-one-public-repo-called-at-main.md)
for why, and for everything else that was decided here.

## What is in the kit

| Workflow | What it does | Caller trigger |
| --- | --- | --- |
| `agent-implement.yml` | `agent:implement` on an issue → `agent/issue-*` branch, implementation, draft PR, `agent:review` label | `issues: [labeled]` |
| `agent-implement-prd.yml` | `agent:implement` on an issue **with sub-issues** → one sub-issue per run on a shared `agent/prd-*` branch, chaining until none are open | `issues: [labeled]` |
| `agent-implement-pr.yml` | `agent:implement` on an agent PR → addresses unresolved review comments | `pull_request_target: [labeled]` |
| `agent-review.yml` | `agent:review` on an agent PR → reviews the diff, can commit fixes, posts the review, marks the PR ready | `pull_request_target: [labeled]` |
| `agent-update-branch.yml` | `agent:update-branch` on an agent PR → merges the base branch in, agent only for conflicts | `pull_request_target: [labeled]` |
| `agent-promote-queued.yml` | An issue closes → flips its unblocked `agent:queued` dependents to `agent:implement` | `issues: [closed]` |
| `expo-pr-preview.yml` | Publishes an EAS update per push to a non-draft PR, with a Convex preview backend when the PR needs one | `pull_request: [opened, synchronize, reopened, ready_for_review, labeled]` |
| `expo-review-main-update.yml` | Publishes the default branch to a fixed EAS channel | `workflow_dispatch` |
| `warm-caches.yml` | Writes the `node_modules` and Metro caches the two Expo workflows read | `push: [main]` + `workflow_dispatch` |

The triggers stay in the caller: a called workflow reads the *caller's* event
context, so the label checks and the draft guard inside these files work
unchanged, but GitHub decides when to run from the caller's `on:` block alone.

## How a repo calls it

Each workflow file in the app repo shrinks to a caller. Keep the file name the
same as the kit's, so `agent-implement.yml` still means what it says.

```yaml
# .github/workflows/agent-implement.yml
name: Agent Implement

on:
  issues:
    types: [labeled]

jobs:
  implement:
    permissions:
      contents: write
      pull-requests: write
      issues: write
    uses: bigapejit/bakuljan/.github/workflows/agent-implement.yml@main
    with:
      package-manager: npm
      sandcastle-path: .sandcastle
      git-user-email: you@users.noreply.github.com
    secrets: inherit
```

Two things are easy to get wrong:

- **`permissions:` belongs on the caller job.** A called workflow can only
  narrow the token it is handed, never widen it, so whatever the kit's job asks
  for has to be granted here first.
- **`secrets: inherit`, not a secrets block.** The kit reads `secrets.AGENT_PAT`,
  `secrets.CLAUDE_CODE_OAUTH_TOKEN`, `secrets.EXPO_TOKEN`,
  `secrets.CONVEX_PREVIEW_DEPLOY_KEY` and the `EXPO_PUBLIC_*` values directly.

The Expo preview caller is the one with real choices in it:

```yaml
# .github/workflows/expo-pr-preview.yml
name: Expo PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, labeled]

jobs:
  update:
    permissions:
      contents: read
      pull-requests: write
    uses: bigapejit/bakuljan/.github/workflows/expo-pr-preview.yml@main
    with:
      convex-preview-mode: per-convex-pr
      convex-seed-function: seed:run
      preview-paths: |
        - "src/**"
        - "convex/**"
        - "app.config.ts"
    secrets: inherit
```

`preview-paths` and `convex-paths` are spliced into the `dorny/paths-filter`
config at the same column as the key above them, so their list items carry no
indentation of their own.

## The two Convex preview modes

`convex-preview-mode` has no default: a repo has to say which shape it is.

- **`per-convex-pr`** — only a PR that touches `convex-paths` gets a backend, and
  it is a throwaway: `--preview-create pr-<number>` deletes and recreates the
  deployment on every push, so its data can never be a stale mix of two schemas
  and the seed runs again each time. For repos where the phone app is the only
  frontend.
- **`shared-branch-backend`** — every previewed PR deploys to
  `--preview-name <branch>`, passed verbatim (slashes included), because that is
  the name Convex derives from the git branch when another CI system — a Vercel
  web preview, say — deploys the same PR. The two frontends land on one backend
  by construction rather than by communication. It uses `--preview-name` rather
  than `--preview-create` because two systems racing to delete each other's
  deployment mid-review is worse than carrying data across pushes, and it retries
  the deploy for the same reason. The seed must be idempotent.

In both modes a PR with a backend of its own skips the Metro transform cache and
bundles cold: Metro inlines `EXPO_PUBLIC_*` values into the modules that read
them and does not key its cache on them, so a warm cache would hand the PR a
bundle pointing at the shared dev backend — the exact swap the publish step goes
out of its way to avoid.

## Secrets the caller must hold

| Secret | Needed by | Without it |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | every agent workflow | the agent cannot run at all |
| `AGENT_PAT` (PAT with `repo` + `workflow`) | every agent workflow | **the loop stops chaining** — see below |
| `EXPO_TOKEN` | preview, review-main, warm-caches | no previews |
| `CONVEX_PREVIEW_DEPLOY_KEY` (a *Preview* deploy key) | preview | backend-changing PRs fall back to the shared dev deployment, with a warning |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CONVEX_URL` | preview, review-main, warm-caches | the preview job fails its environment check |

The `EXPO_PUBLIC_*` values may be repository *variables* instead of secrets; the
kit reads `secrets.X || vars.X`.

**`AGENT_PAT` is load-bearing, not a nicety.** GitHub suppresses workflow
triggers for events raised by the default `GITHUB_TOKEN`. So the PAT is what lets
the implement workflow's `agent:review` label actually start the review, the PRD
chain re-label itself for the next sub-issue, promotion of a queued issue start
an implement run, and — most visibly — `agent-review.yml`'s `gh pr ready` raise a
`ready_for_review` event that the preview workflow can wake on. Without the PAT
each of those lands silently and waits for a human. It also needs the `workflow`
scope, because agent branches sometimes touch `.github/workflows/`.

## Invariants worth not breaking

- **The fork guard.** The `pull_request_target` workflows refuse anything that is
  not a same-repo `agent/*` branch, as their first step, before any checkout or
  secret use. `pull_request_target` is used because the ordinary `pull_request`
  trigger depends on a generated merge commit that GitHub does not produce for
  out-of-date or conflicting PRs — exactly the PRs `agent:update-branch` exists
  for. The guard is what makes that safe.
- **The draft guard.** Drafts publish no preview. The implement agent and then
  the review agent both push to a draft, so a draft preview was code nobody
  scanned and was usually cancelled mid-bundle by the next push. The first
  preview fires on `ready_for_review`, already on the reviewed code.
  `preview:force` overrides the guard for an early look, and a `labeled` event
  publishes only when the added label is `preview:force`, so `agent:*` state
  labels never re-bundle identical code.
- **Caches are written on the default branch and read everywhere else.** A cache
  saved on a branch is visible to that branch and its children only. Every agent
  PR is a branch born and merged the same day, so `warm-caches.yml` is the only
  writer and the two Expo workflows only restore. The cache keys are a cross-file
  contract: change one and change all three.
