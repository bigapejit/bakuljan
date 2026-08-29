import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const workflowPaths = [
  ".github/workflows/warm-caches.yml",
  ".github/workflows/expo-pr-preview.yml",
  ".github/workflows/expo-review-main-update.yml",
] as const;

const workflows = workflowPaths.map((workflowPath) => ({
  path: workflowPath,
  source: fs.readFileSync(path.resolve(workflowPath), "utf8"),
}));

const resolverCommand =
  'const w = require("./package.json").workspaces; const p = Array.isArray(w) ? w : w?.packages; process.exit(Array.isArray(p) && p.length > 0 ? 0 : 1)';

describe("the node_modules cache contract", () => {
  it.each(workflows)("keeps $path workspace-aware", ({ source }) => {
    expect(source).toContain("id: node-modules-paths");
    expect(source).toContain(`node -e '${resolverCommand}'`);
    expect(source).toContain("paths=node_modules");
    expect(source).toContain(
      "paths+=$'\\n**/*/node_modules\\n!**/node_modules/**/node_modules'",
    );
    expect(source).toContain(
      "path: ${{ steps.node-modules-paths.outputs.paths }}",
    );
  });

  it("uses one identical resolver in every cache reader and writer", () => {
    for (const { source } of workflows) {
      expect(source.match(/id: node-modules-paths/g)).toHaveLength(1);
      expect(
        source.match(
          /paths\+=\$'\\n\*\*\/\*\/node_modules\\n!\*\*\/node_modules\/\*\*\/node_modules'/g,
        ),
      ).toHaveLength(1);
    }
  });

  it("never restores a cache using the old root-only literal", () => {
    for (const { source } of workflows) {
      expect(source).not.toMatch(/^\s+path: node_modules\s*$/m);
    }
  });
});
