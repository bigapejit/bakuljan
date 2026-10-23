// Does Codex's latest review of this pull request leave anything that should
// keep its builds waiting? The review gate opens a pull request once the answer
// is no, and from then on builds every push without asking Codex again.
//
// Only a P0 or P1 finding holds the builds. Codex reads the whole diff afresh
// each round and nearly always finds another P2, so waiting for no findings at
// all kept agents in fix-and-re-review loops for hours (frsg-app #558, #565 and
// #616 in October 2026) on pull requests that were ready to merge.
//
// Read from what the Codex GitHub app leaves on a pull request:
//
// - One summary comment it edits in place, with a row for its latest review:
//   `| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="…"> | `abc1234` | … |`
// - Findings, as a pull request review whose commit_id is the reviewed commit,
//   one inline comment per finding, each headed by a priority badge
//   (`![P2 Badge](…)`). Posted before the summary row turns Completed.
// - No findings, as a comment "Didn't find any major issues … Reviewed commit:
//   `abc1234567`" (on a review someone asked for) and/or a 👍 on the pull
//   request a few seconds after the row turns Completed (on the automatic one
//   when a PR opens, where there is no comment).
//
// Codex reviews when a pull request opens, a draft is marked ready, or someone
// comments `@codex review`. A push alone gets no review.
//
// Measured on bigapejit/frsg-app #506–#523 (October 2026): every Completed row
// ended in exactly one of a findings review on that commit or a clean signal.
// On #550–#617, each of the 82 findings reviews had inline comments, and every
// one of those carried a P1 or P2 badge.

export type CodexFacts = {
  /** Issue comments by the Codex app, oldest first. */
  comments: { createdAt: string; body: string }[];
  /** Pull request reviews by the Codex app, each with the first line of each of its inline comments. */
  reviews: { commitId: string; submittedAt: string; findings: string[] }[];
  /** Reactions by the Codex app on the pull request itself. */
  reactions: { content: string; createdAt: string }[];
};

export type CodexVerdict =
  | { kind: "clear"; reason: string }
  | { kind: "held"; reason: string }
  /** Completed with no findings, but the 👍 has not landed yet: ask again shortly. */
  | { kind: "settling"; reason: string };

const SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
const CLEAN_COMMENT = /Didn.t find any major issues[\s\S]*?Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/;
const BADGE = /!\[(P\d) Badge\]/;
const HOLDS = new Set(["P0", "P1"]);
// A 👍 counts for this review only if it came after the row turned Completed.
// It lands about 4s later; one left by an earlier review is minutes older.
const THUMBS_UP_SLACK_MS = 30_000;

type Row = { status: string; completedAt?: number; commit: string };

export function codexVerdict(facts: CodexFacts): CodexVerdict {
  const summary = [...facts.comments].reverse().find((c) => c.body.includes(SUMMARY_MARKER));
  const rows = summary ? summaryRows(summary.body) : [];
  if (rows.length === 0) {
    return { kind: "held", reason: "Codex has not reviewed this pull request" };
  }
  const unfinished = rows.find((r) => r.completedAt === undefined);
  if (unfinished) {
    return { kind: "held", reason: `Codex review of ${unfinished.commit}: ${unfinished.status}` };
  }

  const latest = rows.reduce((a, b) => (b.completedAt! > a.completedAt! ? b : a));
  const commit = latest.commit;
  const priorities = facts.reviews
    .filter((r) => r.commitId.startsWith(commit))
    .flatMap((r) => r.findings.map((f) => BADGE.exec(f)?.[1] ?? "unmarked"));
  const holding = priorities.filter((p) => HOLDS.has(p)).sort();
  if (holding.length > 0) {
    return { kind: "held", reason: `Codex left a ${holding[0]} on ${commit}` };
  }
  if (priorities.length > 0) {
    const kinds = [...new Set(priorities)].sort().join("/");
    return { kind: "clear", reason: `Codex left only ${kinds} findings on ${commit}` };
  }

  const cleanComment = facts.comments.some((c) => {
    const reviewed = CLEAN_COMMENT.exec(c.body)?.[1];
    return reviewed !== undefined && reviewed.startsWith(commit);
  });
  const thumbsUp = facts.reactions.some(
    (r) => r.content === "+1" && Date.parse(r.createdAt) >= latest.completedAt! - THUMBS_UP_SLACK_MS,
  );
  if (cleanComment || thumbsUp) {
    return { kind: "clear", reason: `Codex found nothing on ${commit}` };
  }
  return { kind: "settling", reason: `Codex finished ${commit} and has not confirmed it clean yet` };
}

function summaryRows(body: string): Row[] {
  const rows: Row[] = [];
  for (const line of body.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // ["", kind, status, `commit`, trigger, ""]
    const commit = /^`([0-9a-f]{7,40})`$/.exec(cells[3] ?? "")?.[1];
    if (!commit) continue;
    const status = cells[2] ?? "";
    const done = /\*\*Completed\*\*/.test(status);
    const at = /datetime="([^"]+)"/.exec(status)?.[1];
    rows.push({
      status: status.replace(/<[^>]+>/g, "").replace(/\*\*/g, "").trim(),
      completedAt: done && at ? Date.parse(at) : undefined,
      commit,
    });
  }
  return rows;
}
