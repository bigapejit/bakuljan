// Run by .github/workflows/review-gate.yml with `node --experimental-strip-types`,
// so it imports nothing outside node and this folder: no install step.
//
// Reads the pull request's current head (never the event's, which may be
// stale) and asks codexVerdict about exactly that commit. Writes `clean`,
// `sha`, `branch` and `reason` to GITHUB_OUTPUT.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { codexVerdict, type CodexFacts, type CodexVerdict } from "./codex-verdict.ts";

const repo = required("GH_REPO");
const pr = required("PR_NUMBER");
const codex = process.env.CODEX_LOGIN || "chatgpt-codex-connector[bot]";

// The 👍 that confirms an automatic review lands a few seconds after the
// summary turns Completed, and nothing triggers a workflow when it does.
const SETTLE_TRIES = 6;
const SETTLE_WAIT_MS = 10_000;

const head = api<{ head: { sha: string; ref: string } }>(`repos/${repo}/pulls/${pr}`).head;
let verdict: CodexVerdict = codexVerdict(facts(), head.sha);
for (let i = 1; verdict.kind === "settling" && i < SETTLE_TRIES; i++) {
  console.log(`${verdict.reason}; asking again in ${SETTLE_WAIT_MS / 1000}s`);
  await new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
  verdict = codexVerdict(facts(), head.sha);
}

console.log(`#${pr} ${head.ref} @ ${head.sha}: ${verdict.reason}`);
const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(
    out,
    [
      `clean=${verdict.kind === "clean"}`,
      `sha=${head.sha}`,
      `branch=${head.ref}`,
      `reason=${verdict.reason}`,
      "",
    ].join("\n"),
  );
}

function facts(): CodexFacts {
  const byCodex = (x: { user: { login: string } | null }) => x.user?.login === codex;
  type Item = { user: { login: string } | null };
  return {
    comments: pages<Item & { created_at: string; body: string }>(`repos/${repo}/issues/${pr}/comments`)
      .filter(byCodex)
      .map((c) => ({ createdAt: c.created_at, body: c.body })),
    reviews: pages<Item & { commit_id: string; submitted_at: string }>(`repos/${repo}/pulls/${pr}/reviews`)
      .filter(byCodex)
      .map((r) => ({ commitId: r.commit_id, submittedAt: r.submitted_at })),
    reactions: pages<Item & { content: string; created_at: string }>(`repos/${repo}/issues/${pr}/reactions`)
      .filter(byCodex)
      .map((r) => ({ content: r.content, createdAt: r.created_at })),
  };
}

function pages<T>(path: string): T[] {
  return api<T[][]>(`${path}?per_page=100`, ["--paginate", "--slurp"]).flat();
}

function api<T>(path: string, flags: string[] = []): T {
  return JSON.parse(
    execFileSync("gh", ["api", ...flags, path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  ) as T;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
