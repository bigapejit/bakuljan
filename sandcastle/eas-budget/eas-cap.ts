// Should EAS builds stop? The EAS budget watchdog asks this every ten minutes,
// because Expo has no spending limit of its own: once a paid plan's build
// credit runs out, every further build is billed, with no ceiling.
//
// Two things stop builds:
//
// - Budget: what the billing period has cost so far (the plan plus usage-based
//   charges), plus the most one more build could add, would pass the monthly
//   budget. A build is charged once it finishes, so the check leaves room for
//   one: MAX_BUILD_CENTS, less whatever build credit is still unspent.
// - Loop: one project started more than the daily limit of builds in the last
//   24 hours. That is a workflow building over and over, which would otherwise
//   run until it ate the whole budget. In October 2026 frsg-app's Flight
//   workflow started 45 builds in one day, 60 of 91 of them of identical native
//   code, and $149 of overage came from it (bigapejit/frsg-app #539).
//
// The watchdog cancels builds while either holds, and opens an issue saying
// which. A budget stop lifts by itself once the spend is back under budget (a
// new billing period, or a raised budget). A loop stop lifts only when someone
// closes the issue, so builds from before it was closed do not count again.

export type EasFacts = {
  /** The plan's monthly price, in cents. */
  planCents: number;
  /** Usage-based charges so far this billing period (builds and updates), in cents. */
  overageCents: number;
  /** Build credit that comes with the plan, in cents. */
  creditCents: number;
  /** Build credit used so far this billing period, in cents. */
  creditUsedCents: number;
  /** The account's most recent builds, any order. */
  builds: { app: string; createdAt: string }[];
};

export type EasLimits = {
  budgetCents: number;
  dailyBuildsPerProject: number;
};

export type EasCap = { kind: "ok" | "budget" | "loop"; reason: string };

/** A large iOS build: the dearest build Expo sells (October 2026). */
export const MAX_BUILD_CENTS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param since When a person last lifted a loop stop (closed the issue). Builds
 *   before it don't count towards the daily limit.
 */
export function easCap(facts: EasFacts, limits: EasLimits, now: Date, since?: string): EasCap {
  const spent = facts.planCents + facts.overageCents;
  const credit = Math.max(0, facts.creditCents - facts.creditUsedCents);
  const next = Math.max(0, MAX_BUILD_CENTS - credit);
  if (spent + next > limits.budgetCents) {
    const parts = `the ${usd(facts.planCents)} plan plus ${usd(facts.overageCents)} of usage`;
    return {
      kind: "budget",
      reason:
        spent > limits.budgetCents
          ? `EAS has cost ${usd(spent)} this billing period (${parts}), over the ${usd(limits.budgetCents)} monthly budget`
          : `EAS has cost ${usd(spent)} this billing period (${parts}) with ${usd(credit)} of build credit left, so one more build could pass the ${usd(limits.budgetCents)} monthly budget`,
    };
  }

  const from = Math.max(now.getTime() - DAY_MS, since ? Date.parse(since) : 0);
  const counts = new Map<string, number>();
  for (const b of facts.builds) {
    if (Date.parse(b.createdAt) > from) counts.set(b.app, (counts.get(b.app) ?? 0) + 1);
  }
  const [app, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (count > limits.dailyBuildsPerProject) {
    return {
      kind: "loop",
      reason: `${app} started ${count} builds in the last 24 hours, more than the limit of ${limits.dailyBuildsPerProject} a day`,
    };
  }

  return {
    kind: "ok",
    reason: `EAS has cost ${usd(spent)} of the ${usd(limits.budgetCents)} budget this billing period, and no project is over ${limits.dailyBuildsPerProject} builds a day`,
  };
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
