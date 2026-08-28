import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { baseBranch } from "../repo-context";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const BASE_BRANCH = baseBranch();
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PromptOutput = z.object({
  prTitle: z.string().min(1).max(256),
  prDescription: z.string().min(1),
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const sandcastle = await import("@ai-hero/sandcastle");
  const { noSandbox } = await import(
    "@ai-hero/sandcastle/sandboxes/no-sandbox"
  );

  const result = await sandcastle.run({
    name: `write-pr-#${ISSUE_NUMBER}`,
    agent: sandcastle.claudeCode("claude-opus-5", {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
      },
    }),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: path.join(__dirname, "prompt.md"),
    promptArgs: {
      ISSUE_NUMBER,
      ISSUE_TITLE,
      BRANCH,
      BASE_BRANCH,
    },
    output: sandcastle.Output.object({
      tag: "output",
      schema: PromptOutput,
    }),
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, "pr_title.txt"), result.output.prTitle);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "pr_description.txt"),
    result.output.prDescription
  );

  console.log(`\nWrote PR metadata to ${OUTPUT_DIR}`);
  console.log(`  title: ${result.output.prTitle}`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
