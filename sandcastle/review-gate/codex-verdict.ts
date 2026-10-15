// Has Codex reviewed this exact commit and found nothing? The review gate
// builds only on a yes, so every answer short of a clear one is a no.
//
// Read from what the Codex GitHub app leaves on a pull request:
//
// - One summary comment it edits in place, with a table row per review kind:
//   `| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="…"> | `abc1234` | … |`
// - Findings, as a pull request review whose commit_id is the reviewed commit.
//   Posted before the summary row turns Completed.
// - No findings, as a comment "Didn't find any major issues … Reviewed commit:
//   `abc1234567`" (on a review someone asked for) and/or a 👍 on the pull
//   request a few seconds after the row turns Completed (on the automatic one
//   when a PR opens, where there is no comment).
//
// Measured on bigapejit/frsg-app #506–#523 (October 2026): every Completed row
// ended in exactly one of a findings review on that commit or a clean signal.

export type CodexFacts = {
  /** Issue comments by the Codex app, oldest first. */
  comments: { createdAt: string; body: string }[];
  /** Pull request reviews by the Codex app. */
  reviews: { commitId: string; submittedAt: string }[];
  /** Reactions by the Codex app on the pull request itself. */
  reactions: { content: string; createdAt: string }[];
};

export type CodexVerdict =
  | { kind: "clean"; reason: string }
  | { kind: "not-clean"; reason: string }
  /** Completed with no findings, but the 👍 has not landed yet: ask again shortly. */
  | { kind: "settling"; reason: string };

const SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
const CLEAN_COMMENT = /Didn.t find any major issues[\s\S]*?Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/;
// A 👍 counts for this review only if it came after the row turned Completed.
// It lands about 4s later; one left by an earlier review is minutes older.
const THUMBS_UP_SLACK_MS = 30_000;

type Row = { status: string; completedAt?: number; commit: string };

export function codexVerdict(facts: CodexFacts, headSha: string): CodexVerdict {
  const head = headSha.slice(0, 7);
  const summary = [...facts.comments].reverse().find((c) => c.body.includes(SUMMARY_MARKER));
  if (!summary) {
    return { kind: "not-clean", reason: `Codex has not reviewed ${head}` };
  }

  const rows = summaryRows(summary.body).filter((r) => headSha.startsWith(r.commit));
  if (rows.length === 0) {
    return { kind: "not-clean", reason: `Codex has not reviewed ${head}` };
  }
  const unfinished = rows.find((r) => r.completedAt === undefined);
  if (unfinished) {
    return { kind: "not-clean", reason: `Codex review of ${head}: ${unfinished.status}` };
  }
  if (facts.reviews.some((r) => r.commitId === headSha)) {
    return { kind: "not-clean", reason: `Codex left findings on ${head}` };
  }

  const cleanComment = facts.comments.some((c) => {
    const reviewed = CLEAN_COMMENT.exec(c.body)?.[1];
    return reviewed !== undefined && headSha.startsWith(reviewed);
  });
  const completedAt = Math.max(...rows.map((r) => r.completedAt!));
  const thumbsUp = facts.reactions.some(
    (r) => r.content === "+1" && Date.parse(r.createdAt) >= completedAt - THUMBS_UP_SLACK_MS,
  );
  if (cleanComment || thumbsUp) {
    return { kind: "clean", reason: `Codex found nothing on ${head}` };
  }
  return { kind: "settling", reason: `Codex finished ${head} and has not confirmed it clean yet` };
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
