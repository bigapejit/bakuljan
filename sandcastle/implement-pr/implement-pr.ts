import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { z } from "zod";
import { parseDiffLines } from "../review/parse-diff-lines";
import { runWithExtraction } from "../run-with-extraction";
import { ImplementPrOutput } from "./implement-pr-output";
import { baseBranch, readRepoContext } from "../repo-context";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const BASE_BRANCH = baseBranch();
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PrView = z.object({
  title: z.string(),
  body: z.string().nullable().default(""),
  headRefOid: z.string(),
  comments: z.array(
    z.object({
      id: z.string().optional(),
      author: z.object({ login: z.string() }).nullable().optional(),
      body: z.string(),
      createdAt: z.string().optional(),
    })
  ),
});

const prViewJson = sh(
  `gh pr view ${PR_NUMBER} --json title,body,headRefOid,comments`
);
const prView = PrView.parse(JSON.parse(prViewJson));

const issueMatch = prView.body?.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
const ISSUE_NUMBER = issueMatch?.[1] ?? "";
const ISSUE_TITLE = ISSUE_NUMBER
  ? safeSh(`gh issue view ${ISSUE_NUMBER} --json title --jq .title`).trim()
  : "";

const reviewsJson = sh(
  `gh api repos/{owner}/{repo}/pulls/${PR_NUMBER}/reviews`
);
const reviews = z
  .array(
    z.object({
      id: z.number(),
      user: z.object({ login: z.string() }).nullable(),
      body: z.string().nullable().default(""),
      state: z.string(),
      submitted_at: z.string().nullable().optional(),
    })
  )
  .parse(JSON.parse(reviewsJson));

const graphqlQuery = `
query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:50) {
            nodes {
              id
              path
              line
              originalLine
              body
              author { login }
            }
          }
        }
      }
    }
  }
}`;

const [owner, repo] = required("GH_REPO").split("/");
const threadsJson = execFileSync(
  "gh",
  [
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repo}`,
    "-F",
    `number=${PR_NUMBER}`,
    "-f",
    `query=${graphqlQuery}`,
  ],
  { encoding: "utf8" }
);
const threadsParsed = z
  .object({
    data: z.object({
      repository: z.object({
        pullRequest: z.object({
          reviewThreads: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                isResolved: z.boolean(),
                isOutdated: z.boolean(),
                comments: z.object({
                  nodes: z.array(
                    z.object({
                      id: z.string(),
                      path: z.string().nullable(),
                      line: z.number().nullable(),
                      originalLine: z.number().nullable(),
                      body: z.string(),
                      author: z.object({ login: z.string() }).nullable(),
                    })
                  ),
                }),
              })
            ),
          }),
        }),
      }),
    }),
  })
  .parse(JSON.parse(threadsJson));

const unresolvedThreads =
  threadsParsed.data.repository.pullRequest.reviewThreads.nodes.filter(
    (thread) => !thread.isResolved
  );

const prComments = {
  issue_comments: prView.comments.map((comment) => ({
    author: comment.author?.login ?? "unknown",
    body: comment.body,
    createdAt: comment.createdAt,
  })),
  review_summaries: reviews
    .filter((review) => review.body && review.body.trim().length > 0)
    .map((review) => ({
      author: review.user?.login ?? "unknown",
      state: review.state,
      body: review.body,
      submittedAt: review.submitted_at,
    })),
  review_threads: unresolvedThreads.flatMap((thread) =>
    thread.comments.nodes.map((comment) => ({
      commentId: comment.id,
      threadId: thread.id,
      path: comment.path,
      line: comment.line ?? comment.originalLine,
      author: comment.author?.login ?? "unknown",
      body: comment.body,
    }))
  ),
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const sandcastle = await import("@ai-hero/sandcastle");
  const { noSandbox } = await import(
    "@ai-hero/sandcastle/sandboxes/no-sandbox"
  );

  const result = await runWithExtraction({
    name: `implement-pr-${PR_NUMBER}`,
    agent: sandcastle.claudeCode("claude-opus-5", {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
      },
    }),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: path.join(__dirname, "prompt.md"),
    promptArgs: {
      PR_NUMBER,
      BRANCH,
      ISSUE_NUMBER: ISSUE_NUMBER || "(none)",
      ISSUE_TITLE: ISSUE_TITLE || "(no linked issue)",
      PR_COMMENTS_JSON: JSON.stringify(prComments, null, 2),
      BASE_BRANCH,
      REPO_CONTEXT: readRepoContext(),
    },
    output: sandcastle.Output.object({
      tag: "output",
      schema: ImplementPrOutput,
    }),
    extractionPrompt: fs.readFileSync(
      path.join(__dirname, "extraction.md"),
      "utf8"
    ),
  });

  const commitsThisRun = result.commits.length;
  const replyCount =
    result.output.threadReplies.length +
    result.output.newInlineComments.length +
    result.output.topLevelComments.length;

  if (commitsThisRun === 0 && replyCount === 0) {
    fail(
      "Agent produced no commits and no replies - nothing to do for the unresolved feedback."
    );
  }

  const headSha = sh("git rev-parse HEAD").trim();
  const diffLines = parseDiffLines(safeSh(`git diff ${BASE_BRANCH}...HEAD`));
  const validInlineComments = result.output.newInlineComments.filter(
    (comment) => {
      const fileLines = diffLines.get(comment.path);
      if (!fileLines) {
        console.warn(
          `Dropping inline comment for ${comment.path}:${comment.line} - file not in diff.`
        );
        return false;
      }
      if (!fileLines.has(comment.line)) {
        console.warn(
          `Dropping inline comment for ${comment.path}:${comment.line} - line not in diff hunks.`
        );
        return false;
      }
      return true;
    }
  );

  const validReplyIds = new Set(
    prComments.review_threads.map((comment) => comment.commentId)
  );
  const validThreadReplies = result.output.threadReplies.filter((reply) => {
    if (!validReplyIds.has(reply.commentId)) {
      console.warn(
        `Dropping reply for commentId=${reply.commentId} - not in fetched threads.`
      );
      return false;
    }
    return true;
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "implement_thread_replies.json"),
    JSON.stringify(validThreadReplies, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "implement_new_inline_comments.json"),
    JSON.stringify(
      {
        commit_id: headSha,
        comments: validInlineComments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body,
        })),
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "implement_top_level_comments.json"),
    JSON.stringify(result.output.topLevelComments, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "has_commits.txt"),
    commitsThisRun > 0 ? "true" : "false"
  );

  console.log("\nImplement-PR complete.");
  console.log(`  commits this run: ${commitsThisRun}`);
  console.log(`  thread replies: ${validThreadReplies.length}`);
  console.log(`  new inline comments: ${validInlineComments.length}`);
  console.log(`  top-level comments: ${result.output.topLevelComments.length}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function safeSh(cmd: string): string {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "failure_reason.txt"), message);
  process.exit(1);
}
