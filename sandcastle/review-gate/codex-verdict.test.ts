import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { codexVerdict, type CodexFacts } from "./codex-verdict";

// What the Codex app left on real bigapejit/frsg-app pull requests, trimmed to
// the summary table rows, the first lines of its other comments and the first
// line of each finding.
const prs: Record<string, CodexFacts> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "frsg-app-prs.json"), "utf8"),
);
const pr = (n: number) => prs[n]!;

describe("codexVerdict on real pull requests", () => {
  it.each([
    [506, "a requested review: clean comment and 👍"],
    [510, "a requested review after earlier findings"],
    [513, "the automatic review on open: 👍 only"],
    [519, "the sixth round, after five with findings"],
    [521, "the automatic review on open: 👍 only"],
  ])("#%i is clear: Codex found nothing (%s)", (n) => {
    expect(codexVerdict(pr(n)).kind).toBe("clear");
  });

  it.each([
    [520, "115db4c", "P2", "the fourteenth round"],
    [523, "e0b278b", "P2", "one finding"],
    [616, "123cc25", "P2", "the Roof Service bookings re-review"],
  ])("#%i is clear: Codex left only %s findings, all %s (%s)", (n, commit, kinds) => {
    expect(codexVerdict(pr(n))).toEqual({
      kind: "clear",
      reason: `Codex left only ${kinds} findings on ${commit}`,
    });
  });

  it.each([
    [516, "67aa0ae", "a P1 among P2s"],
    [614, "33e4d67", "a lone P1"],
  ])("#%i is held: Codex left a P1 on %s (%s)", (n, commit) => {
    expect(codexVerdict(pr(n))).toEqual({ kind: "held", reason: `Codex left a P1 on ${commit}` });
  });

  it("judges the latest review, even when commits were pushed after it", () => {
    // #512's head, 25bbf50, came after Codex's last review of cb4296e. Holding
    // its builds until someone asks Codex again is the wait the gate removed.
    expect(codexVerdict(pr(512))).toEqual({
      kind: "clear",
      reason: "Codex left only P2 findings on cb4296e",
    });
  });

  it("holds on a P0 as on a P1", () => {
    const facts = pr(523);
    const p0 = {
      ...facts,
      reviews: facts.reviews.map((r) => ({
        ...r,
        findings: r.findings.map((f) => f.replace("P2 Badge", "P0 Badge")),
      })),
    };
    expect(codexVerdict(p0)).toEqual({ kind: "held", reason: "Codex left a P0 on e0b278b" });
  });
});

describe("codexVerdict while a review is in flight", () => {
  const completed = pr(513);

  it("waits for the 👍 that follows an automatic review by a few seconds", () => {
    const before = { ...completed, reactions: [] };
    expect(codexVerdict(before).kind).toBe("settling");
  });

  it("does not count a 👍 left by an earlier review", () => {
    const stale = { ...completed, reactions: [{ content: "+1", createdAt: "2026-10-13T06:00:00Z" }] };
    expect(codexVerdict(stale).kind).toBe("settling");
  });

  it("is held while the row still says Running", () => {
    const running = {
      ...completed,
      comments: [
        {
          createdAt: "2026-10-13T07:05:08Z",
          body: [
            "<!-- codex-pull-request-review-summary -->",
            '| 📝 **Code Review** | 🔄 **Running** since <relative-time datetime="2026-10-13T07:05:10Z">x</relative-time> | `1a23668` | PR opened |',
          ].join("\n"),
        },
      ],
    };
    expect(codexVerdict(running)).toEqual({
      kind: "held",
      reason: "Codex review of 1a23668: 🔄 Running since x",
    });
  });

  it("is held when Codex never reviewed the pull request", () => {
    expect(codexVerdict({ comments: [], reviews: [], reactions: [] })).toEqual({
      kind: "held",
      reason: "Codex has not reviewed this pull request",
    });
  });
});
