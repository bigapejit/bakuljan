import { describe, expect, it } from "vitest";
import { parseDiffLines } from "./parse-diff-lines";

describe("parseDiffLines", () => {
  it("returns right-side line numbers available for PR review comments", () => {
    const diff = [
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -2,5 +2,6 @@ export function example() {",
      "   const first = 1;",
      "-  const removed = 2;",
      "+  const added = 3;",
      "   return first;",
      "+  // unreachable, but still right-side diff line",
      " }",
    ].join("\n");

    expect(parseDiffLines(diff).get("src/example.ts")).toEqual(
      new Set([2, 3, 4, 5, 6])
    );
  });

  it("keeps files with no right-side lines as empty sets", () => {
    const diff = [
      "diff --git a/src/deleted.ts b/src/deleted.ts",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/src/deleted.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const value = 1;",
      "-export const other = 2;",
    ].join("\n");

    expect(parseDiffLines(diff).get("src/deleted.ts")).toEqual(new Set());
  });
});
