# The harness is kit code; repos keep a context paragraph

ADR-0001 moved the workflows here and left the agent scripts behind, treating
`sandcastle-path` as a caller input like `package-manager` or
`convex-preview-mode`. That was wrong, and this revises it: the scripts are kit
code, and the only per-repo thing in them is one paragraph.

## The evidence

Every `.sandcastle/*.ts` file was byte-identical between `build-pro-v4` (an Expo
app) and `flatx-backend` (a Convex backend) — different runtimes, different
domains, same files to the byte. Only the `prompt.md` files differed, and the
entire delta was one "what to read before you start" paragraph per repo: the
Expo repo said to read `AGENTS.md` and the versioned SDK docs, the backend said
to read `CONTEXT.md`. Nothing else.

Meanwhile the copies had already drifted across four repos in three generations:
`build_pro_v3` was missing `implement-pr/` and `implement-prd/` entirely,
`flat_roof_v9` was missing `implement-prd/`. Nobody decided that. It is what
copies do.

And the cost was not hypothetical. `implement/implement.ts` ran
`git rev-list --count main..HEAD` to decide whether the agent had done anything,
in a workflow that has accepted a `base-branch` input since it was written. Wrong
in all four copies, in the same way, for the same reason: a fix has nowhere to
propagate from.

So `sandcastle-path` was parameterized as an axis of variation. The path is
`.sandcastle` in every repo, and the contents are meant to be identical. It was
never an axis.

## The decision

The harness lives here as `sandcastle/`, and the five agent workflows check this
repo out at `kit-ref` (default `main`) into `.agent-workflow/`, install from this
repo's lockfile, and run it from there. The mechanism is not new:
`agent-implement-pr.yml` already sparse-checked-out its scripts into
`.agent-workflow/` from the caller's base branch, because it acts on a branch the
PR author controls and must never execute that branch's code. Generalizing that
step to point at this repo instead is most of the change — and it strengthens the
guard, because a PR can edit its repo's base branch through a second PR, and it
cannot edit this one at all.

- **The directory is `sandcastle/`, not `.sandcastle/`.** In an app repo the
  harness is tooling and hides; here it is half the repo's content. The dot also
  had a hidden cost worth not repeating: `**/*` does not match a dot-directory,
  so `.sandcastle` was invisible to the app repos' `tsc` and `vitest` and had
  never been typechecked. Moving it under a plain name and pointing this repo's
  `tsconfig.json` at it surfaced a real type error in `runWithRetry` on the first
  run.

- **The checkout is still called `.agent-workflow/`, and is still hidden from
  git.** That name has a job: it is a dot-directory inside the caller's working
  tree, so the app repo's own `tsc`, `vitest`, and `eslint` walk past it while
  the agent runs `npm run typecheck` and `npm run lint`, and `.git/info/exclude`
  keeps it out of anything the agent commits.

- **`kit-ref` defaults to `main`.** ADR-0001 rejected version tags and that still
  holds: with one person and two repos, instant propagation is the point. But a
  harness is not a workflow file — a bad prompt can burn a whole agent run before
  anyone sees it — so `kit-ref` exists as a per-repo escape hatch. Pin it to a
  SHA, fix `main`, unpin. It is not a release process.

- **`sandcastle-path` stays as an accepted input, and is ignored.** Both live
  repos' caller files pass it today, and a `workflow_call` input that vanishes
  fails validation on the callers that still name it. Removing it would break
  both production loops at the moment this lands — precisely the window this
  ordering exists to avoid. The kit switches to its own copy first, the app
  repos' local `.sandcastle` becomes dead weight that nothing reads, and the
  cleanup PRs are then pure deletion.

## The orientation paragraph becomes `.sandcastle/context.md`

The one genuinely per-repo thing in the prompts is now a per-repo file. Every
prompt carries a `{{REPO_CONTEXT}}` placeholder; every script fills it by reading
`.sandcastle/context.md` from the repo being worked on. This is the house rule
already applied to workflows: **apps hold stubs and secrets, never logic.**

A missing file is an empty string, not an error. That is the whole point — a repo
onboards onto the kit before it has anything to declare, and the failure mode of
the alternative is an agent run that dies in prompt assembly. The prompts already
name what every repo has (`CONTEXT.md`, `docs/adr/`); `context.md` is only for
what is extra there.

The content is substituted as data, never executed. Sandcastle marks the shell
blocks (`` !`cmd` ``) written in the raw template *before* argument substitution
and only runs marked ones, so a backtick in a repo's `context.md` is text.

One deliberate behavior change comes with this: the app repos' orientation
sentences had drifted between their own prompts — `build-pro-v4` mentioned
`CLAUDE.md` in `review/` and `implement-pr/` but not in `implement/`. One
`context.md` per repo unifies them. Every prompt in a repo now gets that repo's
full orientation, which is what was meant in the first place.

## What else moved with it

- `git rev-list --count main..HEAD` reads `BASE_BRANCH`, and so do the two
  `git diff main...HEAD` calls and the prompts that quoted `main` in shell blocks
  or in prose. The fallback is `main`, so the behavior of both current callers is
  unchanged — the bug simply cannot be wrong in four places any more.
- The kit gains a `package.json` with the harness's runtime dependencies
  (`tsx`, `@ai-hero/sandcastle`, `zod`) and its own lockfile, so the app repos
  can drop all three. `npm ci --omit=dev` keeps `vitest` and `typescript` out of
  every agent job, and `setup-node`'s cache is keyed on this repo's lockfile
  rather than the caller's, because this one barely moves.
- The sandcastle `Dockerfile` and `.env.example` came along. They were identical
  in both repos and describe the local docker sandbox, not CI, but they belong
  with the code they build an image for.
- `.sandcastle/legacy/` — the archived RALPH loop — did not move. It is
  app-repo history.

## Not decided here

**Dogfooding.** This repo does not run the agent loop on itself. The tension is
unresolved: the loop needs `CLAUDE_CODE_OAUTH_TOKEN` and `AGENT_PAT` in the
repo's own secrets, and this repo's founding invariant is that it holds none.
Issues here get worked from a clone by hand until that is answered.
