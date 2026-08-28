import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The harness now serves every repo on the kit, so the two ways a prompt can
// quietly become repo-specific are worth a test each: hardcoding `main`, and
// hardcoding the orientation paragraph instead of taking it from the repo.
const here = path.dirname(fileURLToPath(import.meta.url));

const files = (extension: string): string[] =>
  fs
    .readdirSync(here, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name));

const prompts = files("prompt.md");
const scripts = files(".ts").filter((file) => !file.endsWith(".test.ts"));

const relative = (file: string) => path.relative(here, file).replaceAll("\\", "/");

describe("prompts", () => {
  it("finds every prompt", () => {
    // A rename that skips this suite is the failure mode these tests exist to
    // avoid, so assert the count rather than trusting an empty it.each.
    expect(prompts).toHaveLength(7);
  });

  it.each(prompts.map(relative))(
    "%s takes its orientation paragraph from the repo",
    (name) => {
      const contents = fs.readFileSync(path.join(here, name), "utf8");
      if (!contents.includes("# CONTEXT")) return;
      // write-pr and write-prd-pr have a CONTEXT section that is pure
      // instruction — they read the issue and the log, never the codebase — so
      // they are the two that legitimately need no repo orientation.
      if (!/Read `CONTEXT\.md`/.test(contents)) return;

      expect(contents).toContain("{{REPO_CONTEXT}}");
    },
  );

  it.each([...prompts, ...scripts].map(relative))(
    "%s diffs against the base branch, not a hardcoded main",
    (name) => {
      // The bug this replaces: `git rev-list --count main..HEAD` in a workflow
      // that already accepted a base-branch input, copied identically into four
      // repos. Centralizing it means it can only be wrong once.
      expect(fs.readFileSync(path.join(here, name), "utf8")).not.toMatch(
        /\bmain\.\.\.?/,
      );
    },
  );
});
