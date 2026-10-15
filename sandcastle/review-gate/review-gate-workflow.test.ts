import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

// The gate and the workflows it starts agree on one label, and the gate runs
// its script without an install. A drift in either is a green check that
// quietly builds nothing.
const gate = fs.readFileSync(path.resolve(".github/workflows/review-gate.yml"), "utf8");
const preview = fs.readFileSync(path.resolve(".github/workflows/expo-pr-preview.yml"), "utf8");

describe("the review gate contract", () => {
  it("starts gated workflows by adding review:clean with AGENT_PAT", () => {
    expect(gate).toContain("GH_TOKEN: ${{ secrets.AGENT_PAT }}");
    expect(gate).toContain('-f "labels[]=review:clean"');
    expect(preview).toContain("github.event.label.name == 'review:clean'");
  });

  it("runs the verdict script straight from the sparse kit checkout", () => {
    expect(gate).toContain("sparse-checkout: sandcastle/review-gate");
    expect(gate).toContain(
      "node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON sandcastle/review-gate/review-gate.ts",
    );
    expect(fs.existsSync(path.resolve("sandcastle/review-gate/review-gate.ts"))).toBe(true);
  });

  it("only wakes on Codex finishing a review, not on every edit of its summary", () => {
    expect(gate).toContain("github.event.comment.user.login == inputs.codex-login");
    expect(gate).toContain("contains(github.event.comment.body, '**Completed**')");
  });

  it("asks Vercel for exactly the cleared commit, past its own dedupe", () => {
    expect(gate).toContain("key: \"REVIEW_GATE_SHA\"");
    expect(gate).toContain("v13/deployments?forceNew=1");
  });
});
