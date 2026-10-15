import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { codexVerdict, type CodexFacts } from "./codex-verdict";

// What the Codex app left on real bigapejit/frsg-app pull requests, trimmed to
// the summary table rows and the first lines of its other comments.
const prs: Record<string, CodexFacts> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "frsg-app-prs.json"), "utf8"),
);
const pr = (n: number) => prs[n]!;

describe("codexVerdict on real pull requests", () => {
  it.each([
    [506, "b75767c90323c89d927f89a0cc7386ada6fcb8e9", "a requested review: clean comment and 👍"],
    [510, "3acb206edd0189cc3a5190407dd407b7b28e00ec", "a requested review after earlier findings"],
    [513, "1a2366828d06df48ce6ab878ea7cc041225ebcff", "the automatic review on open: 👍 only"],
    [519, "b0cf9554cf3f1c6a881f30844b85394a1c243269", "the sixth round, after five with findings"],
    [521, "572066bba8b34bfa7460814894261d13d9b2ca7a", "the automatic review on open: 👍 only"],
  ])("#%i at its head is clean (%s)", (n, sha) => {
    expect(codexVerdict(pr(n), sha).kind).toBe("clean");
  });

  it.each([
    [520, "115db4c37ece1205917f237fc507abdb98b0a1fd"],
    [523, "e0b278b35ebbf2b08e1277b70ec8d6ad094686dc"],
  ])("#%i at its head is not: Codex left findings on it", (n, sha) => {
    expect(codexVerdict(pr(n), sha)).toEqual({
      kind: "not-clean",
      reason: `Codex left findings on ${sha.slice(0, 7)}`,
    });
  });

  it.each([
    [512, "25bbf50796badb11cf8d2dba8e5e05a921f092de"],
    [516, "d1d88352a15072ffba04b7cb69ab56c9c43a72d9"],
  ])("#%i at its head is not: pushed after the last review", (n, sha) => {
    expect(codexVerdict(pr(n), sha)).toEqual({
      kind: "not-clean",
      reason: `Codex has not reviewed ${sha.slice(0, 7)}`,
    });
  });

  it("a clean verdict belongs to the commit it was given for", () => {
    // #519's earlier rounds each had findings, though the PR ended clean.
    expect(codexVerdict(pr(519), "8e0867f0000000000000000000000000000000000").kind).toBe(
      "not-clean",
    );
  });
});

describe("codexVerdict while a review is in flight", () => {
  const sha = "1a2366828d06df48ce6ab878ea7cc041225ebcff";
  const completed = pr(513);

  it("waits for the 👍 that follows an automatic review by a few seconds", () => {
    const before = { ...completed, reactions: [] };
    expect(codexVerdict(before, sha).kind).toBe("settling");
  });

  it("does not count a 👍 left by an earlier review", () => {
    const stale = { ...completed, reactions: [{ content: "+1", createdAt: "2026-10-13T06:00:00Z" }] };
    expect(codexVerdict(stale, sha).kind).toBe("settling");
  });

  it("is not clean while the row still says Running", () => {
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
    expect(codexVerdict(running, sha)).toEqual({
      kind: "not-clean",
      reason: "Codex review of 1a23668: 🔄 Running since x",
    });
  });

  it("is not clean when Codex never reviewed the pull request", () => {
    expect(codexVerdict({ comments: [], reviews: [], reactions: [] }, sha).kind).toBe("not-clean");
  });
});
