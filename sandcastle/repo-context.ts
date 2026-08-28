import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Where a consuming repo puts its orientation paragraph. The path is relative
 * to the repo being worked on, which is always the process cwd: the workflows
 * check the app repo out at the workspace root and run the harness from
 * `.agent-workflow/` without changing directory.
 */
export const REPO_CONTEXT_PATH = ".sandcastle/context.md";

/**
 * The one thing a prompt cannot be centralized without: "what should I read
 * before I start?", which is different in an Expo app and a Convex backend.
 *
 * Every prompt in this harness carries a `{{REPO_CONTEXT}}` placeholder, and
 * every script fills it with this. A repo with nothing extra to say ships no
 * file and gets an empty string — absence is a valid answer, not an error,
 * because a new repo onboards onto the kit before it has anything to declare.
 *
 * Whatever the file holds is substituted as data. Sandcastle marks the shell
 * blocks (`` !`cmd` ``) written in the raw template before substitution and
 * only executes those, so a backtick in a repo's context.md is text.
 */
export function readRepoContext(cwd: string = process.cwd()): string {
  try {
    return fs.readFileSync(path.join(cwd, REPO_CONTEXT_PATH), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * The branch the agent's work is measured against. Every workflow that runs a
 * script with a `base-branch` input exports it; the fallback keeps the scripts
 * runnable by hand.
 */
export function baseBranch(): string {
  return process.env.BASE_BRANCH?.trim() || "main";
}
