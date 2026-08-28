# Setup playbook: install bakuljan in a fresh repo

You are an agent. Point yourself at a repository, work through this file top to
bottom, and that repository ends up on the full bakuljan stack: the triage and
`agent:*` labels, the `docs/agents/*` docs, the nine caller workflows pointing at
`bigapejit/bakuljan@main`, and a printed checklist of the handful of things only
the repo's owner can do.

Everything here is runnable by an agent **except** the last section. Secrets and
Convex dashboard clicks need a human with credentials; you print them, you do not
attempt them.

This document is self-contained. It carries every file it asks you to write. You
do not need to read build-pro-v4, frsg-app, or the kit's own workflow YAML to run
it — though the kit's [README](README.md) is worth reading if a decision below is
close.

**Read the whole file before you write anything.** Step 1 asks questions whose
answers appear in files written in step 4; discovering a question late means
rewriting.

---

## 0. Preconditions

Check all of these before you start. Stop and report if one fails — none of them
is something to work around.

```bash
gh auth status          # authenticated, with `repo` and `workflow` scopes
gh repo view --json nameWithOwner,defaultBranchRef,visibility,isFork
git status              # a clean tree; you are about to add ~20 files
```

- **The repo exists on GitHub and you have push access.** This playbook writes
  labels through the API and files through git.
- **The repo is an Expo app, or at least a Node repo with a lockfile.** The six
  agent workflows work in any Node repo. The three Expo workflows
  (`expo-pr-preview`, `expo-review-main-update`, `warm-caches`) assume an Expo
  project with an EAS account behind it — skip them if there isn't one, and say
  so in your report.
- **GitHub Actions is enabled** (`gh api repos/{owner}/{repo}/actions/permissions`
  → `"enabled": true`).

Record the repo's `nameWithOwner` and default branch name now. Every step below
uses them.

---

## 1. Decisions

Answer these before writing anything. Each is a caller input or a file you seed.
Where you can answer from the repo itself, do — do not ask the owner what
`package.json` already says. Ask only where the criteria genuinely need a human.

Write your answers into a scratch list; step 4 substitutes them into the caller
files.

### 1.1 `package-manager` — npm, pnpm, or yarn

Answer from the repo. Exactly one lockfile exists:

| File present | Answer |
| --- | --- |
| `package-lock.json` | `npm` |
| `pnpm-lock.yaml` | `pnpm` |
| `yarn.lock` | `yarn` |

This decides the install command and `setup-node`'s cache in every workflow. It
is also baked into no cache key, so it is safe to get wrong loudly rather than
quietly — but check the lockfile, don't guess.

### 1.2 `node-version`

Answer from the repo, in this order: `.nvmrc`, then `engines.node` in
`package.json`, then `volta.node`. Nothing found → `"22"`, the kit default.

**This is a cross-file contract.** It is part of both cache keys, so the value in
the `expo-pr-preview` caller and the value in the `warm-caches` caller must be
the same string. If you pass it to one, pass it to the other. If you take the
default, take it in both — omit the input from both files rather than writing it
in one.

### 1.3 `.sandcastle/context.md` — the only agent-side file the repo owns

The agent harness — the implement / review / update-branch scripts and their
prompts — lives in the **kit**, at `sandcastle/` in bakuljan, and the workflows
check it out and run it (ADR-0002). A new repo copies nothing, installs no `tsx`,
and does not need `@ai-hero/sandcastle` or `zod` in its `package.json`.

There is no `sandcastle-path` decision any more. The input still exists on the
five agent workflows and is accepted, but it is ignored and its own description
says "Deprecated and ignored" — **do not write it into a new caller.** Likewise
`kit-ref` (default `main`) names the bakuljan ref the harness runs from; omit it
unless the owner explicitly wants to pin a repo to a tag or SHA.

The one thing the repo still owns is optional: `.sandcastle/context.md`, a short
paragraph the prompts inject at `{{REPO_CONTEXT}}` telling an agent what to read
in *this* repo before it starts. A missing file is fine — it reads as an empty
string, no error.

Write one only if there is something to say that the prompts do not already
cover. They already tell the agent to read `CONTEXT.md` and `docs/adr/`, so this
is for the extra. build-pro-v4's, in full:

```markdown
Also read `AGENTS.md` and `CLAUDE.md`. The Expo SDK versioned docs linked from
`AGENTS.md` are required before writing app code.
```

Keep it to a few lines. It is prepended to every agent prompt in the repo, so
length here is a tax on every run.

### 1.4 `git-user-email` — required, no default

The address agent commits are authored as. Ask the owner if you cannot infer it;
the safe inference is the repo owner's GitHub no-reply address, which
`gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'` builds, or the
short form `<login>@users.noreply.github.com` if that is what the repo's existing
commits use (`git log -20 --format='%ae' | sort -u`).

Why it matters beyond attribution: Vercel matches preview builds on the commit
author's email, so an agent branch only gets a web preview if this address is on
the owner's account.

### 1.5 `preview-paths` — which file changes deserve a preview

A `pull_request` that touches none of these globs publishes nothing. Build the
list from the repo's actual layout. A reasonable starting set, pruned to what
exists:

```
- "src/**"
- "app/**"
- "convex/**"
- "assets/**"
- "app.config.ts"
- "app.json"
- "eas.json"
- "package.json"
- "package-lock.json"
- "tsconfig.json"
- "babel.config.*"
- "metro.config.*"
```

Two rules:

- **Include the lockfile and `package.json`.** A dependency bump changes the
  bundle and is exactly the change worth scanning on a phone.
- **Exclude nothing you are unsure about.** A too-wide list costs a bundle; a
  too-narrow list means a PR silently gets no QR code and the owner assumes the
  workflow is broken. `preview:force` is the escape hatch for what falls through.

The value is spliced into `dorny/paths-filter`'s config at the same column as the
key above it, so the list items carry **no leading indentation of their own**.
Write them flush against the `|` block's own indent, exactly as shown in step 4.

### 1.6 `convex-preview-mode` — the real decision

No default. The repo must say which shape it is.

**Ask: does anything other than the phone app deploy this PR's branch to Convex?**
Typically a Vercel web preview of an `apps/web` or a marketing site in the same
repo, whose build command runs `npx convex deploy`.

- **No — the phone app is the only frontend** → `per-convex-pr`. Only a PR that
  touches `convex-paths` gets a backend, and it is a throwaway:
  `--preview-create pr-<number>` deletes and recreates the deployment on every
  push, so the data can never be a stale mix of two schemas and the seed runs
  fresh each time. Frontend-only PRs keep using the shared dev deployment, which
  is fine because they did not change it.
- **Yes — a second CI system deploys the same branch** → `shared-branch-backend`.
  Every previewed PR deploys to `--preview-name <branch>`, the branch ref passed
  verbatim, slashes included, because that is the name Convex derives from the
  git branch when the other system lets it default. The two frontends land on one
  backend by construction rather than by anyone remembering to coordinate. It
  uses `--preview-name` rather than `--preview-create` because two systems racing
  to delete each other's deployment mid-review is worse than carrying data across
  pushes; for the same reason it retries the deploy three times.

**Consequence of `shared-branch-backend` you must not skip:** the seed function
runs against a deployment that already has data, so **the seed must be
idempotent** — it tops the backend up rather than duplicating it. Read the seed
before you promise this mode works. If the seed inserts unconditionally, say so
in your report; that is a code change, not a config change.

If the repo has no `convex/` directory at all, it has no mode. Pass
`per-convex-pr` (nothing will match `convex-paths`, so nothing happens) and note
it.

### 1.7 `convex-seed-function`

The Convex function `--preview-run` calls to populate a fresh preview backend, in
`file:export` form. Find it: look for a `convex/seed.ts` or `convex/previewSeed.ts`
and read its exported mutation name.

- build-pro-v4 uses `seed:run`; frsg-app uses `previewSeed:seedPreviewData`.
- The kit default is `seed:run`. Do not take the default on faith — a wrong name
  fails the whole deploy step, and the PR gets no preview at all.

### 1.8 `eas-update-branch` — leave it alone

The default is `pr-branch`, which names the published update after the PR's head
ref with slashes replaced (`agent/issue-1-x` → `agent-issue-1-x`) and uses the PR
title as the update message. That is what you want in every case:

- In `shared-branch-backend` mode the name is a *handle* — near enough to the
  Convex deployment's name that one string finds a PR's bundle and its backend in
  both dashboards.
- In either mode the dev client's extensions panel lists one entry per PR.

`auto` passes `--auto`, which reads the name out of git. A `pull_request`
checkout is a detached HEAD, so `auto` puts every PR in the repo on one EAS
branch literally named `HEAD`. It is kept only as an escape hatch back to the
historical behavior. **Do not pass `eas-update-branch` at all** unless the owner
asks for `auto` by name.

### 1.9 `app-variant`, `eas-environment`, `eas-platform`, `eas-channel`

Take the defaults (`review`, `preview`, `ios`, `review-main`) unless the repo
contradicts them:

- `app-variant` — only relevant if `app.config.ts` switches on `APP_VARIANT`.
  Grep for it. If the repo has no such switch, the input is inert; leave it.
- `eas-environment` — must name an environment that exists in EAS. Check
  `eas.json`. **This is a cross-file contract with `warm-caches`**, same rule as
  `node-version`: same value in both callers, or the default in both.
- `eas-platform` — `ios` for the preview and warm callers (a QR for the owner's
  phone), `all` for review-main. These are the defaults.
- `eas-channel` (review-main only) — `review-main`. The channel must exist in EAS
  or the first run says so; that goes on the owner checklist.

### 1.10 npm workspaces: answer before the warm-caches caller is useful

If this is a workspaces repo (`workspaces` in the root `package.json`), stop and
look. `warm-caches` caches the path `node_modules` and nothing else. In a
workspaces repo, npm hoists most packages to the root but leaves per-workspace
`node_modules` trees behind for anything it cannot hoist — so restoring only the
root tree can hand a build a dependency set that is subtly incomplete.

Do not paper over this. Write the warm-caches caller anyway (a cache that misses
costs nothing but time — restores just miss and the preview installs as it does
today), and **open an issue in the repo** recording the workspace cache question
as unanswered. Say so in your report.

Non-workspaces repo → nothing to decide, carry on.

---

## 2. Labels

Create the full set. `--force` makes this idempotent and also corrects GitHub's
stock `wontfix` (which ships with a different color and description) rather than
erroring on it.

Run this as one block. Substitute nothing.

```bash
set -e

# The five canonical triage roles the engineering skills speak in.
gh label create "needs-triage"        --color FBCA04 --description "Maintainer needs to evaluate this issue" --force
gh label create "needs-info"          --color D876E3 --description "Waiting on reporter for more information" --force
gh label create "ready-for-agent"     --color 0E8A16 --description "Fully specified, ready for an AFK agent" --force
gh label create "ready-for-human"     --color 1D76DB --description "Needs human implementation" --force
gh label create "wontfix"             --color ffffff --description "This will not be worked on" --force

# Workflow state labels. These are triggers and locks, not decoration.
gh label create "agent:implement"     --color 0E8A16 --description "Trigger the agent-implement workflow" --force
gh label create "agent:queued"        --color C5DEF5 --description "Waiting on a blocker; auto-promoted to agent:implement when unblocked" --force
gh label create "agent:review"        --color FBCA04 --description "Trigger the agent-review workflow on this PR" --force
gh label create "agent:update-branch" --color 0E8A16 --description "Trigger: merge base into this PR" --force
gh label create "agent:blocked"       --color B60205 --description "Agent run failed; re-add the trigger label to retry" --force
gh label create "agent:in-progress"   --color FBCA04 --description "An agent workflow is currently running on this issue/PR" --force

# Read by expo-pr-preview.yml: overrides the draft guard and the path filter.
gh label create "preview:force"       --color 1D76DB --description "Force an Expo PR preview update" --force
```

**Optional — only if this repo will use the `/wayfinder` skill.** These are not
read by any kit workflow; they exist because the seeded `issue-tracker.md`
describes wayfinding operations.

```bash
gh label create "wayfinder:map"       --color 0E8A16 --description "Wayfinder shared map (index)" --force
gh label create "wayfinder:research"  --color 1D76DB --description "Wayfinder research ticket (AFK)" --force
gh label create "wayfinder:grilling"  --color 5319E7 --description "Wayfinder grilling ticket (HITL)" --force
gh label create "wayfinder:prototype" --color FBCA04 --description "Wayfinder prototype ticket (HITL)" --force
gh label create "wayfinder:task"      --color 006B75 --description "Wayfinder task ticket" --force
```

Verify:

```bash
gh label list --limit 100 --json name --jq '.[].name' | sort
```

Every name in the two required blocks above must appear.

---

## 3. Repo prerequisites

Two things the kit expects to find in the repo. Both are real changes to
`package.json`; make them on the same branch as everything else.

### 3.1 Pin `eas-cli` as a devDependency

The Expo workflows put `$GITHUB_WORKSPACE/node_modules/.bin` on `PATH` and expect
`eas` to be there. They deliberately do **not** install it with
`expo/expo-github-action@v8`: that action's own eas-cli cache is answered with
HTTP 400 by the current GitHub cache service on every run, so it silently
reinstalls the CLI from scratch — about 26 seconds of every preview. Riding the
`node_modules` cache instead costs nothing.

```bash
# Exact pin, no caret: the CLI is a build tool, and a float here changes what a
# preview publishes without anything in the repo changing.
npm install --package-lock-only --save-exact --save-dev eas-cli@23.0.0
```

Adjust the version if `eas.json`'s `cli.version` constraint demands newer. Check
the resulting lockfile diff before committing — expect packages added, none
removed.

Skip this if the repo has no EAS setup and you are skipping the Expo callers.

### 3.2 Nothing for the agent half

There used to be a second prerequisite here — `tsx` plus the sandcastle
dependencies. There is not any more: the harness moved into the kit and brings
its own `package.json` and lockfile. Do not add `tsx`, `@ai-hero/sandcastle` or
`zod` to the app repo on the agent loop's account. If they are already there for
the repo's own reasons, leave them.

---

## 4. Caller workflow files

Nine files in `.github/workflows/`. Keep the kit's file names — `agent-review.yml`
still means what it says, and the seeded docs point at these names.

Every caller is the same three-part shape and it is worth understanding rather
than copying blind:

- **The `on:` block stays here.** A called workflow reads the *caller's* event
  context, so the label checks and the draft guard inside the kit files work
  unchanged — but GitHub decides when to run from the caller's `on:` block alone.
  A reusable workflow cannot own its own trigger. This is why the warm-caches
  caller exists at all (see 4.9).
- **`permissions:` belongs on the caller job.** A called workflow can only narrow
  the token it is handed, never widen it, so whatever the kit's job asks for has
  to be granted here first.
- **`secrets: inherit`, never a `secrets:` block.** The kit reads
  `secrets.AGENT_PAT`, `secrets.CLAUDE_CODE_OAUTH_TOKEN`, `secrets.EXPO_TOKEN`,
  `secrets.CONVEX_PREVIEW_DEPLOY_KEY` and the `EXPO_PUBLIC_*` values by name.
  Enumerating them in the caller means every new kit secret needs a PR in every
  repo.

**Substitute every `{{PLACEHOLDER}}` as you write.** When you are done, run
`grep -rn '{{' .github/workflows/` and expect no output.

Placeholders used below:

| Placeholder | From |
| --- | --- |
| `{{PACKAGE_MANAGER}}` | 1.1 |
| `{{GIT_USER_EMAIL}}` | 1.4 |
| `{{PREVIEW_PATHS}}` | 1.5 |
| `{{CONVEX_PREVIEW_MODE}}` | 1.6 |
| `{{CONVEX_SEED_FUNCTION}}` | 1.7 |
| `{{DEFAULT_BRANCH}}` | step 0 |

`node-version` is omitted from every file below, which takes the kit default of
`"22"` consistently. If 1.2 chose something else, add
`node-version: "<value>"` to **both** `expo-pr-preview.yml` and
`warm-caches.yml`, and to the agent callers.

### 4.1 `.github/workflows/agent-implement.yml`

```yaml
name: Agent Implement

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.

on:
  issues:
    types: [labeled]

jobs:
  implement:
    # A called workflow can only narrow the token it is handed, so the
    # permissions it needs have to be granted here.
    permissions:
      contents: write
      pull-requests: write
      issues: write
    uses: bigapejit/bakuljan/.github/workflows/agent-implement.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
      # Vercel matches preview builds on the commit author's email, so agent
      # branches commit as the owner's no-reply address.
      git-user-email: {{GIT_USER_EMAIL}}
    secrets: inherit
```

The agent harness itself lives in the kit, so there is no `sandcastle-path` and
no scripts to copy. `kit-ref` defaults to `main`; omit it. Both of these apply to
4.2 through 4.5 as well.

### 4.2 `.github/workflows/agent-implement-prd.yml`

```yaml
name: Agent Implement PRD

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.

on:
  issues:
    types: [labeled]

jobs:
  implement-prd:
    permissions:
      contents: write
      pull-requests: write
      issues: write
    uses: bigapejit/bakuljan/.github/workflows/agent-implement-prd.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
      git-user-email: {{GIT_USER_EMAIL}}
    secrets: inherit
```

Both this and 4.1 fire on the same event. That is correct and not a race:
`agent-implement.yml` detects that the issue has sub-issues and steps aside.

### 4.3 `.github/workflows/agent-implement-pr.yml`

```yaml
name: Agent Implement (PR)

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.
#
# pull_request_target rather than pull_request: it runs in the base repo
# context, so labeled events still fire when the generated merge commit is
# unavailable. The called workflow's first step refuses anything except
# same-repo agent/* branches before any checkout or secret use.

on:
  pull_request_target:
    types: [labeled]

jobs:
  implement-pr:
    permissions:
      contents: write
      issues: write
      pull-requests: write
    uses: bigapejit/bakuljan/.github/workflows/agent-implement-pr.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
      git-user-email: {{GIT_USER_EMAIL}}
    secrets: inherit
```

### 4.4 `.github/workflows/agent-review.yml`

```yaml
name: Agent Review

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.
#
# pull_request_target rather than pull_request: it runs in the base repo
# context, so labeled events still fire when the generated merge commit is
# unavailable. The called workflow's first step refuses anything except
# same-repo agent/* branches before any checkout or secret use.

on:
  pull_request_target:
    types: [labeled]

jobs:
  review:
    permissions:
      contents: write
      issues: write
      pull-requests: write
    uses: bigapejit/bakuljan/.github/workflows/agent-review.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
      git-user-email: {{GIT_USER_EMAIL}}
    secrets: inherit
```

### 4.5 `.github/workflows/agent-update-branch.yml`

```yaml
name: Agent Update Branch

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.
#
# pull_request_target rather than pull_request: the standard trigger depends on
# a generated merge commit, which GitHub fails to produce when the PR is out of
# date or conflicting — exactly the PRs this workflow exists for.

on:
  pull_request_target:
    types: [labeled]

jobs:
  update-branch:
    permissions:
      contents: write
      issues: write
      pull-requests: write
    uses: bigapejit/bakuljan/.github/workflows/agent-update-branch.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
      git-user-email: {{GIT_USER_EMAIL}}
    secrets: inherit
```

### 4.6 `.github/workflows/agent-promote-queued.yml`

```yaml
name: Agent Promote Queued

# The body of this workflow lives in bigapejit/bakuljan, shared with the other
# repos on the same agent loop. See docs/agents/cloud-agent-flow.md.

on:
  issues:
    types: [closed]

jobs:
  promote:
    permissions:
      issues: write
    uses: bigapejit/bakuljan/.github/workflows/agent-promote-queued.yml@main
    secrets: inherit
```

This kit workflow takes no inputs — it only talks to the GitHub API.

### 4.7 `.github/workflows/expo-pr-preview.yml`

The one caller with real choices in it. `{{PREVIEW_PATHS}}` expands to the list
from 1.5, one `- "glob"` per line, at exactly the indentation shown (six spaces —
the same column as `preview-paths:` itself, because the kit splices the value
into `dorny/paths-filter`'s config beneath a key at that column).

```yaml
name: Expo PR Preview

# The body of this workflow lives in bigapejit/bakuljan. See
# docs/agents/convex-previews.md for what a previewed PR gets.
#
# ready_for_review is load-bearing and stays here, in the caller, because the
# trigger is the one thing a called workflow cannot own: it is the moment an
# agent PR becomes something the owner is meant to scan, and the kit's draft
# guard publishes nothing before it. agent-review.yml marks PRs ready using
# AGENT_PAT precisely so this event fires at all — an event raised by the
# default GITHUB_TOKEN is suppressed by GitHub.

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
      package-manager: {{PACKAGE_MANAGER}}
      convex-preview-mode: {{CONVEX_PREVIEW_MODE}}
      convex-seed-function: {{CONVEX_SEED_FUNCTION}}
      preview-paths: |
        {{PREVIEW_PATHS}}
    secrets: inherit
```

Add `convex-paths:` in the same block shape **only** in `per-convex-pr` mode and
only if the backend does not live in `convex/**` (the default). It is not
consulted at all in `shared-branch-backend` mode.

Do not add `eas-update-branch` — see 1.8.

### 4.8 `.github/workflows/expo-review-main-update.yml`

```yaml
name: Expo Review Main Update

# The body of this workflow lives in bigapejit/bakuljan. It publishes the
# default branch to the review-main channel, so the owner can scan one QR that
# always shows what is merged. Run by hand.

on:
  workflow_dispatch:

jobs:
  update:
    permissions:
      contents: read
    uses: bigapejit/bakuljan/.github/workflows/expo-review-main-update.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
    secrets: inherit
```

### 4.9 `.github/workflows/warm-caches.yml` — do not skip this one

**This is the file every setup forgets, which is why the playbook stamps it in.**

GitHub scopes Actions cache storage **per repository**, and a cache saved on a
branch is visible to that branch and its children only — caches saved on the
default branch are visible repo-wide. Every agent PR is a branch born and merged
the same day, so a preview can never warm itself. The default branch has to be
the writer.

Cache warming is therefore kit *logic* but necessarily a per-repo *caller*: a
reusable workflow cannot own its trigger, and the trigger is the whole point.
Skip this file and nothing breaks — previews just silently pay full install and
full cold bundle forever, on every PR, with a green check. That is exactly the
kind of omission a checklist exists to catch.

```yaml
name: Warm CI caches

# The body of this workflow lives in bigapejit/bakuljan. It writes the
# node_modules and Metro caches the Expo workflows restore; a cache saved on a
# branch is readable from that branch alone, so the default branch has to be
# the writer.
#
# Nothing cached depends on prose, hence paths-ignore: a docs-only merge would
# spend two minutes re-bundling identical code, and the previous cache stays the
# newest one under the prefix the preview restores by.
#
# workflow_dispatch covers the one case a merge does not: an EXPO_PUBLIC_* value
# changing in the EAS preview environment or in repo secrets. Metro inlines
# those into the modules that read them and does not key its cache on them, so
# previews keep bundling the old value until this is run by hand.

on:
  push:
    branches: [{{DEFAULT_BRANCH}}]
    paths-ignore:
      - "**/*.md"
      - "docs/**"
  workflow_dispatch:

jobs:
  warm:
    permissions:
      contents: read
    uses: bigapejit/bakuljan/.github/workflows/warm-caches.yml@main
    with:
      package-manager: {{PACKAGE_MANAGER}}
    secrets: inherit
```

The three cache-key inputs — `node-version`, `app-variant`, `eas-environment` —
are a cross-file contract between this file and `expo-pr-preview.yml`. Change one
and change both, or every preview goes back to a cold run, silently.

---

## 5. Seed `docs/agents/*`

Six documents. Write each one exactly as given, with `{{...}}` substituted. They
are what the engineering skills read to learn this repo's tracker, label
vocabulary, and doc layout; the cloud-agent and Convex docs are what a future
agent reads to understand why a preview did or did not appear.

If a file already exists, **read it before overwriting**. A repo that already has
a `docs/agents/convex-previews.md` may know something the template does not —
merge rather than clobber, and say what you merged.

### 5.1 `docs/agents/issue-tracker.md`

```markdown
# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all
operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, fetching labels when workflow state matters.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside
a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs
as feature requests; `/triage` reads this flag.)_

GitHub shares one number space across issues and PRs, so a bare `#42` may be
either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Cloud agent entrypoints

- Label an issue `agent:implement` to start `.github/workflows/agent-implement.yml`.
- Label a blocked issue `agent:queued` when it is ready but waiting on native GitHub `blocked by` dependencies.
- Label an agent PR `agent:implement` to ask the PR feedback workflow to address unresolved review comments.
- Label an agent PR `agent:update-branch` to ask the update workflow to merge the base branch into it.

The workflows own issue and PR mutation. The agent harness they run (which lives
in `bigapejit/bakuljan`, not here) emits files and commits; it does not replace
the GitHub label state machine.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
```

### 5.2 `docs/agents/triage-labels.md`

```markdown
# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in this tracker | Meaning                                  |
| -------------------------- | --------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`        | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`     | Fully specified, ready for agent work    |
| `ready-for-human`          | `ready-for-human`     | Requires human implementation            |
| `wontfix`                  | `wontfix`             | Will not be actioned                     |

When a skill mentions a role, use the corresponding label string from this table.

## Agent state labels

The `agent:*` labels track an issue or PR's position in the cloud workflow:

| Label                 | Surface    | Meaning                                                                                                        |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `agent:implement`     | issue + PR | On an issue, start implementation and open a draft PR. On a PR, address unresolved human or reviewer feedback. |
| `agent:queued`        | issue      | Ready for agent work but waiting on declared native GitHub blockers. Auto-promotes when blockers clear.        |
| `agent:in-progress`   | issue + PR | A workflow run is active.                                                                                      |
| `agent:review`        | PR         | PR is ready for the automated review workflow.                                                                 |
| `agent:blocked`       | issue + PR | A run failed or was refused; needs human attention before retry.                                               |
| `agent:update-branch` | PR         | Merge the base branch into the agent branch, invoking the agent only if conflicts require it.                  |

State labels are triggers and locks, not decorative status. Do not add more than
one trigger label unless a workflow specifically documents that transition.

## Preview label

| Label            | Surface | Meaning                                                                                     |
| ---------------- | ------- | ------------------------------------------------------------------------------------------- |
| `preview:force`  | PR      | Publish an Expo preview even for a draft PR, or one that touched no `preview-paths` file.   |
```

### 5.3 `docs/agents/domain.md`

(Four-backtick fence here only because the file itself contains fenced blocks;
write the file with ordinary triple backticks.)

````markdown
# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence;
don't suggest creating them upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when
terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift
to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
````

### 5.4 `docs/agents/cloud-agent-flow.md`

```markdown
# Cloud Agent Flow

This repo's agent work is driven by GitHub Actions and GitHub labels.

Every `.github/workflows/*.yml` named below is a **caller**: it holds the
trigger, the permissions, and this repo's inputs, and the steps live in
[`bigapejit/bakuljan`](https://github.com/bigapejit/bakuljan) at `@main`, shared
with the other repos on the same loop. Read the caller for what fires and what
this repo passes; read bakuljan for what runs. A fix there lands here on the next
run, with no PR in this repo.

The agent harness the workflows execute — the implement, review and
update-branch scripts and their prompts — also lives in bakuljan, at
`sandcastle/`. This repo holds no copy of it. The one agent-side file this repo
owns is optional: `.sandcastle/context.md`, a short paragraph injected into every
agent prompt saying what to read here before starting.

## Current path

1. A human labels an issue `agent:implement`.
2. `.github/workflows/agent-implement.yml` validates the issue, creates an `agent/issue-...` branch, runs the kit's implement harness, pushes commits, writes a draft PR, and labels the PR `agent:review`.
3. `.github/workflows/agent-review.yml` runs on the draft PR, reviews the diff, can commit small improvements, posts a PR review, replies to review threads where useful, and marks the PR ready for human review.
4. A human reviews and merges. Agents do not merge to the default branch.

## PRD path

`agent:implement` on an issue **with sub-issues** (a PRD) is handled by
`.github/workflows/agent-implement-prd.yml` instead; `agent-implement.yml`
detects the shape and steps aside.

1. A human labels the PRD (the parent issue) `agent:implement`. Sub-issues are never labeled directly — `agent-implement.yml` refuses those and points at the parent.
2. The workflow picks the **first still-open sub-issue**, implements just that one, and commits to a single shared `agent/prd-...` branch (resumed across runs, never force-pushed).
3. On success it closes the sub-issue, opens a draft PR for the branch on the first run (later runs reuse the PR), and — while open sub-issues remain — re-labels the PRD `agent:implement` so the chain continues (requires `AGENT_PAT`).
4. When the last sub-issue closes, the PR is labeled `agent:review` and the normal review path takes over. The PR body ends with `Closes #<PRD>` so merging closes the PRD.

Flat only: nested PRDs (a PRD that is itself a sub-issue) and sub-issues with
their own sub-issues are refused.

## PR feedback path

- Label an agent PR `agent:implement` to run `.github/workflows/agent-implement-pr.yml`. It addresses unresolved PR comments and review threads, then replies or comments with what changed.
- Label an agent PR `agent:update-branch` to run `.github/workflows/agent-update-branch.yml`. It performs a deterministic merge from the base branch first; the agent is invoked only for conflicts.

## Queued issues

Use native GitHub issue dependencies for blockers. If an issue is ready but
blocked, label it `agent:queued`. When the final blocker closes,
`.github/workflows/agent-promote-queued.yml` flips the issue to
`agent:implement`; with `AGENT_PAT` configured, that label add triggers
implementation automatically.

The implement workflow also guards `agent:implement`: if an issue still has an
open native `blocked by` dependency, it refuses and converts the issue to
`agent:queued`.

## Previews

Drafts publish nothing. The implement agent and then the review agent both push
to a draft, so a draft preview was code nobody had scanned and was usually
cancelled mid-bundle by the next push. The first preview fires when the review
agent marks the PR ready — which is why `agent-review.yml` marks PRs ready using
`AGENT_PAT`: an event raised by the default `GITHUB_TOKEN` is suppressed by
GitHub and no preview would fire at all. Add `preview:force` for an early look at
a draft.

## Required secrets and labels

- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code. Without it no agent workflow runs.
- `AGENT_PAT` — a PAT with `repo`, `workflow`, `read:org`. Without it, labels added by workflows land but do not trigger the next workflow, and the loop stops chaining.
- The labels in `docs/agents/triage-labels.md`, already created in GitHub.
```

### 5.5 `docs/agents/queued-promotion.md`

````markdown
# Queued Promotion

The `agent:queued` label marks an issue as ready for agent work but waiting on
native GitHub blockers. When the last blocker closes,
`.github/workflows/agent-promote-queued.yml` flips the issue to
`agent:implement`, which starts the normal implement flow.

## Trigger

The workflow listens for `issues: closed` events. Closes with
`state_reason == 'not_planned'` are skipped because a wontfix blocker is not a
completion signal.

## Dependency model

Blockers are read from GitHub's native issue dependency relation, the
`blocked by` / `blocks` feature queried through GraphQL `blocking` and
`blockedBy`. The workflow does not parse prose such as "Blocked by #N" from issue
bodies.

Add an edge with:

```bash
gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by \
  --input - <<< '{"issue_id": <blocker-database-id>}'
```

`<blocker-database-id>` is the blocker's numeric database id
(`gh api repos/<owner>/<repo>/issues/<n> --jq .id`), not its `#number`.

## Behavior per dependent

| Dependent state                                  | Action                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Missing `agent:queued`                           | Silent skip.                                                                                           |
| Has `agent:in-progress`                          | Silent skip; a run is already active.                                                                  |
| Is a sub-issue of another issue                  | Remove `agent:queued`, add `agent:blocked`, and comment that the parent PRD should be labeled instead. |
| Still has open blockers                          | Silent skip; wait for the last blocker to close.                                                       |
| No remaining open blockers, still `agent:queued` | Remove `agent:queued`, comment, then add `agent:implement` using `AGENT_PAT` when available.           |
````

### 5.6 `docs/agents/convex-previews.md`

Two openings. Keep the one matching 1.6's answer, delete the other, then keep
everything from "The mechanics" down.

**If `per-convex-pr`:**

```markdown
# Convex preview deployments

A PR that touches `convex/**` gets its own throwaway Convex backend named
`pr-<number>`, created and seeded by the Expo PR preview workflow, and that PR's
Expo preview is pointed at it. PRs that leave `convex/` alone keep using the
shared dev deployment, which is fine because they did not change it. Convex
deletes preview deployments itself a few days after creation, so there is no
cleanup to run.

That is the `convex-preview-mode: per-convex-pr` input which
`.github/workflows/expo-pr-preview.yml` passes to the shared workflow in
[`bigapejit/bakuljan`](https://github.com/bigapejit/bakuljan).

- **Every push resets the backend.** The deployment is deleted, recreated and reseeded (`{{CONVEX_SEED_FUNCTION}}`) on each push to the PR. Anything entered by hand in a preview is gone on the next commit — which is the point: its data can never be a stale mix of two schemas.
```

**If `shared-branch-backend`:**

```markdown
# Convex preview deployments

Every PR that publishes a preview gets a Convex backend named after the PR's git
branch, seeded by `{{CONVEX_SEED_FUNCTION}}`. That is the
`convex-preview-mode: shared-branch-backend` input which
`.github/workflows/expo-pr-preview.yml` passes to the shared workflow in
[`bigapejit/bakuljan`](https://github.com/bigapejit/bakuljan). Frontend-only PRs
are not an exception: the repo's other CI system creates the branch's preview
backend for every PR anyway, so the phone bundle joins it rather than splitting
off onto the shared dev deployment. One preview per branch, reused across pushes
and check re-runs; Convex deletes preview deployments itself a few days after
creation, so there is no cleanup to run.

**One backend, both frontends.** The web preview build and
`.github/workflows/expo-pr-preview.yml` deploy to the *same* preview deployment,
because a preview that split them in two could not review anything crossing the
surfaces. They land together by both using Convex's CI naming, which is derived
from the branch: the web build lets it default, the workflow passes
`--preview-name` explicitly (its `pull_request` checkout is on a detached HEAD,
where the default would be the useless name `HEAD`). Both come from the same
Preview deploy key and neither can touch dev or prod.

- **A preview keeps its data across pushes.** Each push redeploys the branch's functions and schema over the existing deployment; it is not wiped. The seed must be idempotent, so it tops the backend up rather than duplicating it. If a schema change makes old rows invalid, the push fails — delete the deployment in the Convex dashboard and let the next push rebuild it.
```

**Then, in both cases:**

```markdown
The mechanics (flags, URL capture, why the publish step drops `--environment`)
are documented in the kit workflow's comments. What the workflow can't tell you:

- **Drafts publish nothing.** The first QR arrives when the review agent marks the PR ready. Add `preview:force` for an early look.
- **Opening the preview:** the workflow comments a QR code on the PR; open it with the dev client, or pick the update branch from the dev client's extensions panel. The EAS update branch is the git branch with its slashes replaced (`agent/issue-117-foo` → `agent-issue-117-foo`), near enough to the Convex preview deployment's name that one name identifies a PR's bundle and its backend in both dashboards. The bundle carries the preview deployment's URL, so no `.env.local` edits are needed on-device.
- **Local testing without touching dev:** to run a backend-changing branch against a real backend locally, do NOT run `npx convex dev` — it would push the branch's schema onto the live dev deployment, and it keeps pushing for as long as it runs, including from a stale worktree on some other branch, which is how a shared dev deployment gets silently held at the wrong version. Instead set `EXPO_PUBLIC_CONVEX_URL` / `EXPO_PUBLIC_CONVEX_SITE_URL` in `.env.local` to the PR's preview deployment URL, found in the Convex dashboard's deployment picker.
- **Testing a PR on the phone:** open the PR's EAS update, not a local Metro server. A dev client pointed at `npx expo start` loads whatever branch that terminal is sitting on against whatever backend `.env.local` names — two choices with nothing checking that they match.

## One-time setup

These are the owner's, not an agent's.

1. Convex dashboard → project settings → **Deploy keys** → generate a **Preview**
   deploy key (it can only create preview deployments, never touch dev or prod,
   which is why it is safe to hand to a workflow that runs on every PR) → save it
   as the GitHub repository secret `CONVEX_PREVIEW_DEPLOY_KEY`. Until that secret
   exists, PRs that need a backend fall back to the shared dev deployment with a
   workflow warning.
2. Convex dashboard → project settings → **Environment Variables** → set the
   defaults new preview deployments inherit. A fresh preview deployment starts
   with none, so anything the app's backend reads at runtime has to be here or it
   is missing in every preview. `CLERK_JWT_ISSUER_DOMAIN` (the dev Clerk
   instance's) is the minimum for sign-in to work; copy whatever else the dev
   deployment's settings hold — image/CDN credentials, payment keys, geocoding
   keys — for whichever features a preview should exercise.
3. Create `EXPO_TOKEN` at <https://expo.dev/settings/access-tokens> as a
   repository secret, and set the `EXPO_PUBLIC_*` repository variables the
   workflow reads (Convex URL, Clerk publishable key, and any analytics keys)
   from `.env.local`.
4. If another CI system (a web preview) deploys the same branch, leave its Convex
   preview name at the default derived from the branch. That default is what the
   Expo workflow matches.
```

### 5.7 Point `AGENTS.md` at them

Seeding docs nothing reads is theatre. Add or extend the repo's `AGENTS.md` (and
`CLAUDE.md`, if the repo has one, which can simply `@AGENTS.md`) with a short
section per doc — a one-line summary plus the path. Follow the repo's existing
tone; do not paste the docs themselves.

```markdown
## Agent skills

### Issue tracker

Issues and specs live as GitHub issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Cloud agent flow

Agent work is driven by GitHub Actions labels. Label an issue `agent:implement` to create an `agent/*` branch and draft PR; label an agent PR `agent:implement` to address PR feedback; label an agent PR `agent:update-branch` to update it from the base branch. The workflow bodies live in `bigapejit/bakuljan`. See `docs/agents/cloud-agent-flow.md`.

### Triage labels

Five canonical triage roles mapped 1:1 to GitHub label strings, plus `agent:*` workflow state labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Convex previews

A PR that needs a backend gets its own seeded preview deployment; never run `npx convex dev` to test a branch's backend changes. See `docs/agents/convex-previews.md`.
```

---

## 6. Verify

Run all of these. Do not skip to step 7 on a partial pass.

```bash
# 1. No placeholder survived.
grep -rn '{{' .github/workflows/ docs/agents/ && echo "FAIL: placeholders left" || echo "OK"

# 2. Every caller file is valid YAML.
#    `npx -y js-yaml` needs no local install and works where neither the repo's
#    node_modules nor python's PyYAML is available — which is the common case in
#    a repo you have not installed yet.
for f in .github/workflows/*.yml; do
  npx -y js-yaml "$f" > /dev/null 2>&1 && echo "ok    $f" || echo "FAIL  $f"
done

# 3. Each caller references bakuljan@main, inherits secrets, grants permissions.
grep -L 'bigapejit/bakuljan' .github/workflows/*.yml
grep -L 'secrets: inherit' .github/workflows/*.yml
grep -L 'permissions:'     .github/workflows/*.yml
```

Expect no output from the three `grep -L` calls (every file matches).

Then push the branch, merge it, and ask GitHub whether it parsed the files:

```bash
# 4. GitHub's own parse. Every one of the nine must be listed and active.
gh workflow list --all
gh api repos/{owner}/{repo}/actions/workflows --jq '.workflows[] | "\(.state)\t\(.path)"'
```

Workflows only register once they are on the **default branch**, so this check
means merging first. A file with a syntax error either fails to appear or shows
an error annotation on its first run.

Last, the file-name check the seeded docs depend on:

```bash
ls .github/workflows/
# agent-implement.yml         agent-review.yml            expo-pr-preview.yml
# agent-implement-pr.yml      agent-update-branch.yml     expo-review-main-update.yml
# agent-implement-prd.yml     agent-promote-queued.yml    warm-caches.yml
```

---

## 7. Print this for the owner

Everything above was yours. Everything below needs credentials or a dashboard,
so print it verbatim as the last thing you do, filled in with the repo's name.
Do not summarise it, do not attempt any of it, and do not ask for the values.

The list is exhaustive: it names every `secrets.*` and `vars.*` reference in the
kit's workflow YAML, and nothing else. `GITHUB_TOKEN` is deliberately absent —
GitHub provides it automatically.

```text
================================================================================
 bakuljan setup — the part only you can do
 Repo: <owner>/<repo>
 Settings → Secrets and variables → Actions → https://github.com/<owner>/<repo>/settings/secrets/actions
================================================================================

A. REQUIRED FOR THE AGENT LOOP  (label an issue, get a PR)

  CLAUDE_CODE_OAUTH_TOKEN     [secret]
      Read by: all six agent workflows.
      Get it:  `claude setup-token`, or your existing Claude Code OAuth token.
      Without: no agent workflow can run at all.

  AGENT_PAT                   [secret]  ← the one people skip; don't
      A classic Personal Access Token with scopes:  repo, workflow, read:org
      Get it:  https://github.com/settings/tokens
      Read by: all six agent workflows.
      Without it the loop LOOKS fine and quietly stops chaining. GitHub
      suppresses workflow triggers for events raised by the default
      GITHUB_TOKEN, so every hand-off between workflows lands silently:
        - agent-implement's `agent:review` label never starts the review;
        - the PRD chain's re-label never picks up the next sub-issue;
        - a promoted `agent:queued` issue never starts implementing;
        - most visibly, agent-review's `gh pr ready` raises a
          ready_for_review event GitHub drops on the floor — so a PR that
          just went ready NEVER GETS A PREVIEW. No QR code, no error.
      `workflow` scope: agent branches sometimes touch .github/workflows/,
      and a push containing those is rejected without it.
      `read:org` scope: without it the workflows' label writes fail and fall
      back to the suppressed default token — the same silent stall.

B. REQUIRED FOR PHONE PREVIEWS  (the QR code on a PR)

  EXPO_TOKEN                  [secret]
      Get it:  https://expo.dev/settings/access-tokens
      Read by: expo-pr-preview, expo-review-main-update, warm-caches.
      Without: the preview job fails its environment check (red), and the
               warm-caches job refuses to run rather than cache a bundle
               with missing values baked in.

  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY    [secret OR repository variable]
  EXPO_PUBLIC_CONVEX_URL               [secret OR repository variable]
      Copy from the app's .env.local.
      Read by: expo-pr-preview, expo-review-main-update, warm-caches.
               The kit reads `secrets.X || vars.X`, so a repository
               VARIABLE is fine and is easier to eyeball later.
      Without: the preview job fails its environment check by name.

C. STRONGLY RECOMMENDED

  CONVEX_PREVIEW_DEPLOY_KEY   [secret]
      Must be a *Preview* deploy key — it can only create preview
      deployments, never touch dev or prod, which is why it is safe in a
      workflow that runs on every PR.
      Read by: expo-pr-preview.
      Without: a PR that needs its own backend still gets a preview, but one
               pointed at the shared dev deployment, with a workflow warning
               and without the branch's backend changes. It looks like it is
               testing the branch. It is not.

D. OPTIONAL — set only if the app actually reads them
   (each is [secret OR repository variable], forwarded into the bundle only
    when it has a value: an EXPO_PUBLIC_* set to "" is not the same as unset,
    because Metro inlines whatever is there.)

  EXPO_PUBLIC_CONVEX_SITE_URL          for an app that does not derive the
                                       .convex.site twin itself. When a PR
                                       gets its own backend the workflow
                                       overwrites this with that deployment's
                                       own twin.
  EXPO_PUBLIC_POSTHOG_API_KEY
  EXPO_PUBLIC_POSTHOG_HOST

  Nothing else is read. Adding a new EXPO_PUBLIC_* name needs a change in
  bakuljan (in two places per workflow) — a secret whose name is only known
  at run time cannot be read.

--------------------------------------------------------------------------------
 E. CONVEX DASHBOARD — one-time, https://dashboard.convex.dev
--------------------------------------------------------------------------------

  1. Project settings → Deploy keys → "Generate a Preview deploy key".
     Paste it as the CONVEX_PREVIEW_DEPLOY_KEY secret above.

  2. Project settings → Environment Variables.
     These are the DEFAULTS a newly created preview deployment inherits. A
     fresh preview starts with none, so anything the backend reads at runtime
     has to be listed here or it is missing in every preview.
       - CLERK_JWT_ISSUER_DOMAIN (the dev Clerk instance's) — the minimum for
         sign-in to work at all.
       - Copy the rest from the dev deployment's own settings: image/CDN
         credentials, payment keys, geocoding keys, model API keys — whatever
         the features you want to exercise in a preview actually need.

--------------------------------------------------------------------------------
 F. EXPO DASHBOARD — one-time, https://expo.dev
--------------------------------------------------------------------------------

  3. Confirm the EAS environment named in the callers ("preview" by default)
     exists and holds the app's variables. The preview and warm-caches jobs
     both bundle under it.

  4. The `review-main` channel used by "Expo Review Main Update" must exist.
     The first run tells you if it does not; create it in the dashboard.

--------------------------------------------------------------------------------
 G. FIRST SMOKE TEST — after the pastes above
--------------------------------------------------------------------------------

  Merge anything to the default branch, then check the Actions tab: "Warm CI
  caches" should run and finish green in 2-3 minutes. That is the cheapest
  proof that EXPO_TOKEN and the EAS environment are right.

  Then label a small issue `agent:implement` and walk away. Expect: a draft PR
  within minutes, an automated review on it, the PR flipping to ready, and a
  QR-code comment a few minutes after it goes ready — and NOT before, because
  drafts publish nothing.

  If the PR goes ready and no QR ever appears, that is AGENT_PAT. Every time.
================================================================================
```

---

## 8. Report

Close out with:

- The decisions from step 1 and what each was based on.
- Anything you installed that is inert and why — most often: no `convex/`
  directory (1.6), or no EAS account (step 0), which leaves the three Expo
  callers unusable while the six agent callers work.
- Whether you wrote a `.sandcastle/context.md` (1.3), and what it says.
- Anything you left as an open question — most often the workspaces cache
  question (1.10), or a seed function that is not idempotent in
  `shared-branch-backend` mode (1.6).
- The owner checklist from step 7, and the explicit note that **nothing works
  until section A is pasted**.
