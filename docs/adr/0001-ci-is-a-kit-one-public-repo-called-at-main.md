# CI is a kit: one public repo, called at @main

This is bakuljan's founding decision, taken in `bigapejit/build-pro-v4` (where it
is recorded as ADR-0031) before this repo existed. It is reproduced here because
this is its permanent home; build-pro-v4's copy is the pointer from that repo's
perspective.

The agent workflows (implement, review, update-branch, promote-queued) and the
Expo PR preview workflow existed as near-identical copies in
`bigapejit/build-pro-v4` and `bigapejit/frsg-app`, already drifted by dozens of
lines, and every new repo meant redoing labels, docs, secrets, and workflow files
by hand. Decision: the workflows move to one **public** repo, `bigapejit/bakuljan`,
as `workflow_call` reusable workflows; each app repo keeps only ~15-line caller
files referencing them at `@main`. The kit also carries a setup playbook — a spec
an agent runs against a fresh repo to create the triage/`agent:*` labels, seed
`docs/agents/*`, and print the secrets checklist.

## How the pieces sit

- **Secrets never leave the app repos.** bakuljan is public and holds none.
  Reusable workflows execute in the caller's context; `secrets: inherit` hands
  them the calling repo's `CLAUDE_CODE_OAUTH_TOKEN`, `EXPO_TOKEN`,
  `CONVEX_PREVIEW_DEPLOY_KEY`, and `EXPO_PUBLIC_*` values. Per-repo secrets are
  also the only option on a personal account — organization secrets would require
  an org and migrating both repos into it, which is more setup than the problem
  deserves.
- **Public, not private.** A private shared repo can't be called from other
  private repos without an org; the YAML contains process, not secrets, and the
  pattern it implements is already published openly by its originator.
- **`@main`, not version tags.** One person, two repos: the point of centralizing
  is that a fix propagates everywhere instantly. A breaking change breaks both
  repos loudly on the next PR and gets fixed once. Tags are ceremony for external
  consumers that don't exist.
- **Convex preview wiring is a caller input, not repo-specific code.** Two modes:
  `per-convex-pr` (build-pro-v4 — throwaway `--preview-create` backend only for
  PRs touching `convex/**`) and `shared-branch-backend` (frsg-app — every
  previewed PR gets a branch-named backend that Vercel's web preview lands on by
  Convex's default CI naming; the two frontends share one backend by
  construction, never by communication). Any repo can flip modes by editing one
  input line. Seed function name and package manager are inputs for the same
  reason.

## Rejected: EAS Workflows

Moving previews to Expo's own CI was evaluated and rejected. Previews are EAS
*Updates* — JS bundles built by the CI runner and merely hosted by Expo; no iOS
build is involved, so EAS Workflows' one distinctive capability
(fingerprint-conditional builds) buys nothing here. Against that: ~3× GitHub's
per-minute price for the same bundling work, concurrency of 1 on the Starter plan
(parallel agent PRs would queue single-file — directly against the
label-it-and-walk-away flow), and no cross-repo sharing of workflow config, which
defeats the kit. GitHub Actions stays the engine.

## Deliberate no-s

- **Previews are per-push on non-draft PRs; drafts are silent.** The
  scan-the-QR loop is the owner's substitute for running the app locally (iOS
  development without a Mac), so every push to a PR the owner can see gets a
  preview. But the draft phase — implement agent pushes, review agent pushes
  fixes over them — produced previews nobody ever scanned: two publishes per PR
  with only the second one looked at, and ~22% of runs cancelled mid-bundle. So
  drafts publish nothing unless `preview:force` is applied; the first preview
  fires on `ready_for_review`, already on the reviewed code, and later pushes to
  the ready PR (the feedback loop) preview per-push as before. The review
  workflow already marks PRs ready with `AGENT_PAT` specifically so this event
  can trigger workflows — events raised by the default `GITHUB_TOKEN` are
  suppressed and would leave ready PRs with no preview at all.
- **Speed comes from the workflow, not the trigger.** Measured baseline: p50 4:18
  push-to-QR. The paid-for fixes: the `Detect preview scope` job folds into the
  publish job as a step (a 5-second job billed at one rounded minute, hundreds of
  times a month), `node_modules` is cached whole rather than just the npm
  download cache, and `expo/expo-github-action`'s eas-cli cache — observed broken
  (HTTP 400) on every sampled run in both repos — is replaced so eas-cli stops
  being reinstalled from scratch each run. Target ~3:00; the remaining floor is
  Metro bundling, which shrinks with module count or with a warm transform cache
  (below).
- **Caches are written on `main` and read everywhere else.** A cache saved on a
  branch is visible to that branch and its children only; caches saved on the
  default branch are visible repo-wide. Every agent PR is a branch born and
  merged the same day, so a preview can never warm itself. `warm-caches.yml` runs
  on every push to `main`, saves `node_modules` keyed on the lockfile plus
  `patches/`, bundles once with `expo export`, and saves Metro's transform cache;
  the preview job (and `expo-review-main-update.yml`) restore both and never
  save. eas-cli moved into the lockfile as a pinned devDependency, so it rides
  the same `node_modules` cache instead of being reinstalled by an action whose
  own cache 400s.
- **The Metro cache is warm-only for PRs that share main's public environment.**
  Metro writes its transform cache to `os.tmpdir()/metro-cache` (so CI pins
  `TMPDIR`, and a test in the consuming repo proves the location), and it keys
  entries on file content and transform options — *not* on `EXPO_PUBLIC_*`
  values, which Babel inlines into whichever modules read them. Two exports
  differing only in `EXPO_PUBLIC_CONVEX_URL` were measured producing
  byte-identical bundles carrying the first run's URL. So a PR with a backend of
  its own, the one case where that URL is per-PR, skips the restore and bundles
  cold rather than risk a QR pointed at the shared dev backend; the warm job
  bundles under `eas env:exec preview` so every other PR's inlined values match
  what `--environment preview` supplies. Changing an `EXPO_PUBLIC_*` value in EAS
  leaves the cache stale until `main` is re-warmed, which is why the warm
  workflow also takes `workflow_dispatch`.
- **No self-hosted runner.** Biggest raw cost lever, rejected for maintenance
  burden.

Rollout: fixes land in build-pro-v4 first and prove themselves on real PRs; then
extraction to bakuljan; then frsg-app onboards (also picking up the
`expo-review-main-update.yml` it is missing); the playbook is written last, from
the experience of that migration.
