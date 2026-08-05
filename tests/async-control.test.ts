import { describe, expect, it } from "vitest";
import { createExclusiveRunner, createProgressScheduler, createSerialQueue, isLatestRequest, settleSubscription } from "../src/lib/asyncControl";

describe("async control helpers", () => {
  it("serializes mutations and continues after a rejection", async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const first = queue(async () => {
      order.push("first-start");
      await Promise.resolve();
      order.push("first-end");
      throw new Error("expected");
    });
    const second = queue(async () => {
      order.push("second");
      return 2;
    });
    await expect(first).rejects.toThrow("expected");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("recognizes only the latest refresh response", () => {
    expect(isLatestRequest(2, 2)).toBe(true);
    expect(isLatestRequest(1, 2)).toBe(false);
  });

  it("unsubscribes when listen resolves after cleanup", () => {
    let removed = false;
    let assigned = false;
    settleSubscription(() => true, () => { assigned = true; }, () => { removed = true; });
    expect(removed).toBe(true);
    expect(assigned).toBe(false);
  });

  it("coalesces progress commits until the scheduled frame", () => {
    const frames: Array<() => void> = [];
    const commits: number[] = [];
    const schedule = createProgressScheduler<number>((flush) => frames.push(flush), (value) => commits.push(value));
    schedule(10);
    schedule(20);
    expect(commits).toEqual([]);
    frames[0]();
    expect(commits).toEqual([20]);
  });

  it("shares the in-flight operation for concurrent update actions", async () => {
    const runExclusive = createExclusiveRunner();
    let calls = 0;
    let release!: () => void;
    const operation = () => new Promise<void>((resolve) => { calls += 1; release = resolve; });
    const first = runExclusive(operation);
    const second = runExclusive(operation);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(calls).toBe(1);
    release();
    await first;
  });
});
