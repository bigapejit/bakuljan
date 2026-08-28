import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { REPO_CONTEXT_PATH, baseBranch, readRepoContext } from "./repo-context";

const made: string[] = [];

const repoWith = (contents?: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-context-"));
  made.push(dir);
  if (contents !== undefined) {
    const file = path.join(dir, REPO_CONTEXT_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return dir;
};

afterEach(() => {
  while (made.length > 0) {
    fs.rmSync(made.pop()!, { recursive: true, force: true });
  }
  delete process.env.BASE_BRANCH;
});

describe("readRepoContext", () => {
  it("reads the repo's orientation paragraph", () => {
    // The one per-repo thing left in the prompts. An Expo app says "read the
    // versioned SDK docs"; a backend says something else entirely.
    const repo = repoWith("Also read `AGENTS.md`.\n");

    expect(readRepoContext(repo)).toBe("Also read `AGENTS.md`.");
  });

  it("returns an empty string when the repo has no context file", () => {
    // Absence is an answer, not a failure: a repo onboards onto the kit before
    // it has anything repo-specific to say, and every prompt still has to
    // render. A throw here would take the whole agent run down.
    expect(readRepoContext(repoWith())).toBe("");
  });

  it("returns an empty string when the path is a directory, not a file", () => {
    const repo = repoWith();
    fs.mkdirSync(path.join(repo, REPO_CONTEXT_PATH), { recursive: true });

    expect(readRepoContext(repo)).toBe("");
  });
});

describe("baseBranch", () => {
  it("uses BASE_BRANCH when the workflow exports one", () => {
    process.env.BASE_BRANCH = "develop";

    expect(baseBranch()).toBe("develop");
  });

  it("falls back to main when it is unset or blank", () => {
    // Scripts are runnable by hand, and agent-update-branch.yml has no
    // base-branch input at all — it works off the PR's own base ref.
    delete process.env.BASE_BRANCH;
    expect(baseBranch()).toBe("main");

    process.env.BASE_BRANCH = "  ";
    expect(baseBranch()).toBe("main");
  });
});
