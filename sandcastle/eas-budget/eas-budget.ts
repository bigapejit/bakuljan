// Run by .github/workflows/eas-budget.yml with `node --experimental-strip-types`,
// so it imports nothing outside node and this folder: no install step.
//
// Reads the Expo account's spend and recent builds, asks easCap whether builds
// should stop, and keeps one open `eas-cap` issue in this repo while they do:
//
// - It opens the issue, mentioning EAS_CAP_NOTIFY, when a stop starts. That
//   mention is the only message anyone gets; while builds may run, it's silent.
// - While the issue is open it cancels every queued or running build on the
//   account, whoever started it. The kit's eas-cap action reads the same issue,
//   so CI stops before it starts a build at all.
// - It closes a budget stop's issue once the spend is back under budget. A
//   loop stop's issue stays open until a person closes it.

import { execFileSync } from "node:child_process";

import { easCap, type EasCap } from "./eas-cap.ts";

const token = required("EXPO_TOKEN");
const account = required("EAS_ACCOUNT");
const repo = required("GH_REPO");
const notify = required("EAS_CAP_NOTIFY");
const limits = {
  budgetCents: Math.round(Number(required("EAS_MONTHLY_BUDGET_USD")) * 100),
  dailyBuildsPerProject: Number(process.env.EAS_DAILY_BUILDS_PER_PROJECT || 10),
};
if (!(limits.budgetCents >= 0) || !(limits.dailyBuildsPerProject >= 1)) {
  console.error("EAS_MONTHLY_BUDGET_USD and EAS_DAILY_BUILDS_PER_PROJECT must be numbers");
  process.exit(1);
}

const LABEL = "eas-cap";
const ACTIVE = new Set(["NEW", "IN_QUEUE", "IN_PROGRESS"]);

type Build = { id: string; status: string; platform: string; createdAt: string; app: { slug: string } };
type Issue = { number: number; body: string | null; closed_at: string | null };

const now = new Date();
const data = await expo<{
  account: {
    byName: {
      subscription: { price: number } | null;
      billingPeriod: { end: string };
      usageMetrics: {
        builds: { totalCost: number; planMetrics: { serviceMetric: string; value: number; limit: number }[] };
        updates: { totalCost: number };
      };
      activityTimelineProjectActivities: Partial<Build>[];
    };
  };
}>(
  `query EasBudget($account: String!, $now: DateTime!) {
    account {
      byName(accountName: $account) {
        subscription { price }
        billingPeriod(date: $now) { end }
        usageMetrics {
          builds: byBillingPeriod(date: $now, service: BUILDS) {
            totalCost
            planMetrics { serviceMetric value limit }
          }
          updates: byBillingPeriod(date: $now, service: UPDATES) { totalCost }
        }
        activityTimelineProjectActivities(limit: 100, filterTypes: [BUILD]) {
          ... on Build { id status platform createdAt app { slug } }
        }
      }
    }
  }`,
  { account, now: now.toISOString() },
);
const acct = data.account.byName;
const credit = acct.usageMetrics.builds.planMetrics.find((m) => m.serviceMetric === "BUILDS");
const builds = acct.activityTimelineProjectActivities.filter((b): b is Build => !!b.id);

let open = issues("open")[0];
const lastLifted = issues("closed")
  .map((i) => i.closed_at!)
  .sort()
  .at(-1);
const cap = easCap(
  {
    planCents: Math.round((acct.subscription?.price ?? 0) * 100),
    overageCents: acct.usageMetrics.builds.totalCost + acct.usageMetrics.updates.totalCost,
    creditCents: credit?.limit ?? 0,
    creditUsedCents: credit?.value ?? 0,
    builds: builds.map((b) => ({ app: b.app.slug, createdAt: b.createdAt })),
  },
  limits,
  now,
  lastLifted,
);
console.log(`${account}: ${cap.reason}`);

if (open && kindOf(open) === "budget" && cap.kind !== "budget") {
  gh(["--method", "PATCH", `repos/${repo}/issues/${open.number}`, "-f", "state=closed", "-f", "state_reason=completed"]);
  comment(open.number, `Builds can run again: ${cap.reason}.`);
  console.log(`Closed #${open.number}`);
  open = undefined;
}
if (!open && cap.kind !== "ok") open = openIssue(cap, acct.billingPeriod.end);

if (open) {
  const cancelled: string[] = [];
  for (const b of builds.filter((b) => ACTIVE.has(b.status))) {
    await expo(`mutation ($id: ID!) { build { cancelBuild(buildId: $id) { id } } }`, { id: b.id });
    cancelled.push(`- ${b.app.slug} ${b.platform.toLowerCase()} build \`${b.id}\`, started ${b.createdAt}`);
  }
  if (cancelled.length) comment(open.number, `Cancelled ${cancelled.length}:\n\n${cancelled.join("\n")}`);
  console.log(`#${open.number} is open: cancelled ${cancelled.length} build(s)`);
}

function openIssue(cap: EasCap, periodEnd: string): Issue {
  gh(["--method", "POST", `repos/${repo}/labels`, "-f", `name=${LABEL}`, "-f", "color=b60205",
    "-f", "description=EAS builds are stopped while this is open"], true);
  const lift =
    cap.kind === "budget"
      ? `Builds start again by themselves once the spend is back under budget: when the billing period ends (${periodEnd}), or when EAS_MONTHLY_BUDGET_USD in this repo's Actions variables is raised.`
      : "Close this issue once the loop is fixed, and builds can start again. Builds from before you close it don't count again.";
  const body = [
    `@${notify} EAS builds on the \`${account}\` Expo account are stopped: ${cap.reason}.`,
    "",
    "While this issue is open, the EAS budget workflow cancels every queued or running build on the account within about ten minutes, and the kit's `eas-cap` action fails CI before it starts one.",
    "",
    lift,
    "",
    `<!-- eas-cap:${cap.kind} -->`,
  ].join("\n");
  const title = cap.kind === "budget" ? "EAS builds stopped: monthly budget reached" : "EAS builds stopped: a project is building in a loop";
  const issue = JSON.parse(
    gh(["--method", "POST", `repos/${repo}/issues`, "-f", `title=${title}`, "-f", `body=${body}`, "-f", `labels[]=${LABEL}`]),
  ) as Issue;
  console.log(`Opened #${issue.number}`);
  return issue;
}

function kindOf(issue: Issue): string | undefined {
  return /<!-- eas-cap:(\w+) -->/.exec(issue.body ?? "")?.[1];
}

function issues(state: "open" | "closed"): Issue[] {
  return JSON.parse(gh([`repos/${repo}/issues?labels=${LABEL}&state=${state}&per_page=100`])) as Issue[];
}

function comment(issue: number, body: string): void {
  gh(["--method", "POST", `repos/${repo}/issues/${issue}/comments`, "-f", `body=${body}`]);
}

function gh(args: string[], quiet = false): string {
  try {
    return execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"] });
  } catch (e) {
    if (quiet) return "";
    throw e;
  }
}

async function expo<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length || !json.data) {
    throw new Error(`Expo API: ${res.status} ${json.errors?.map((e) => e.message).join("; ") ?? ""}`);
  }
  return json.data;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
