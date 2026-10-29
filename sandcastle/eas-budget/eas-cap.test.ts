import { describe, expect, it } from "vitest";

import { easCap, type EasFacts } from "./eas-cap.ts";

const now = new Date("2026-10-29T12:00:00Z");
const limits = { budgetCents: 1900, dailyBuildsPerProject: 10 };

// silentdave on the Starter plan: $19 a month with $45 of build credit.
function facts(over: Partial<EasFacts> = {}): EasFacts {
  return { planCents: 1900, overageCents: 0, creditCents: 4500, creditUsedCents: 0, builds: [], ...over };
}

function builds(app: string, n: number, at = "2026-10-29T11:00:00Z") {
  return Array.from({ length: n }, () => ({ app, createdAt: at, active: false }));
}

describe("easCap", () => {
  it("lets builds run while the plan's credit covers the next one", () => {
    expect(easCap(facts({ creditUsedCents: 4100 }), limits, now).kind).toBe("ok");
  });

  it("stops builds when one more could spill past the budget", () => {
    const cap = easCap(facts({ creditUsedCents: 4200 }), limits, now);
    expect(cap.kind).toBe("budget");
    expect(cap.reason).toContain("$3 of build credit left");
  });

  it("counts builds still running against the credit they will use", () => {
    // $8 of credit left covers one running build and the next, but not two running.
    const running = (n: number) => builds("frsg", n).map((b) => ({ ...b, active: true }));
    expect(easCap(facts({ creditUsedCents: 3700, builds: running(1) }), limits, now).kind).toBe("ok");
    const cap = easCap(facts({ creditUsedCents: 3700, builds: running(2) }), limits, now);
    expect(cap.kind).toBe("budget");
    expect(cap.reason).toContain("$8 of build credit left, 2 builds still running");
  });

  it("stops builds once usage charges pass the budget", () => {
    // The billing period that ended 2026-10-28: $149 of overage on top of the plan.
    const cap = easCap(facts({ overageCents: 14900, creditUsedCents: 4500 }), limits, now);
    expect(cap).toEqual({
      kind: "budget",
      reason: "EAS has cost $168 this billing period (the $19 plan plus $149 of usage), over the $19 monthly budget",
    });
  });

  it("lets overage run up to a budget that allows it", () => {
    const loose = { ...limits, budgetCents: 5000 };
    // $19 + $27 + a $4 build lands on $50 exactly; a cent more is over.
    expect(easCap(facts({ overageCents: 2700, creditUsedCents: 4500 }), loose, now).kind).toBe("ok");
    expect(easCap(facts({ overageCents: 2701, creditUsedCents: 4500 }), loose, now).kind).toBe("budget");
  });

  it("stops a project building in a loop", () => {
    const cap = easCap(facts({ builds: [...builds("frsg-flight", 11), ...builds("frsg", 2)] }), limits, now);
    expect(cap).toEqual({
      kind: "loop",
      reason: "frsg-flight started 11 builds in the last 24 hours, more than the limit of 10 a day",
    });
  });

  it("allows the daily limit itself, and counts each project apart", () => {
    const cap = easCap(facts({ builds: [...builds("frsg-flight", 10), ...builds("frsg", 10)] }), limits, now);
    expect(cap.kind).toBe("ok");
  });

  it("forgets builds older than a day", () => {
    const cap = easCap(facts({ builds: builds("frsg-flight", 20, "2026-10-28T11:00:00Z") }), limits, now);
    expect(cap.kind).toBe("ok");
  });

  it("doesn't count builds from before a loop stop was lifted again", () => {
    const f = facts({ builds: builds("frsg-flight", 20, "2026-10-29T09:00:00Z") });
    expect(easCap(f, limits, now, "2026-10-29T10:00:00Z").kind).toBe("ok");
  });
});
