export type Unsubscribe = () => void;

/** Runs async mutations in submission order, while keeping the queue usable after failures. */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation, operation);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

/** Allows at most one asynchronous operation at a time and reopens after it settles. */
export function createExclusiveRunner() {
  let active: Promise<void> | null = null;
  return (operation: () => Promise<void>) => {
    if (active) return active;
    const run = Promise.resolve().then(operation);
    const settled = run.finally(() => { if (active === settled) active = null; });
    active = settled;
    return settled;
  };
}

/** Returns whether a response belongs to the latest request. */
export function isLatestRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

/** Prevents a late Tauri listen() resolution from leaking a subscription. */
export function settleSubscription(
  disposed: () => boolean,
  assign: (unsubscribe: Unsubscribe) => void,
  unsubscribe: Unsubscribe,
) {
  if (disposed()) unsubscribe();
  else assign(unsubscribe);
}


/** Coalesces frequent progress events into one UI commit per animation frame. */
export function createProgressScheduler<T>(schedule: (flush: () => void) => unknown, commit: (value: T) => void) {
  let scheduled = false;
  let pending: T | undefined;
  return (value: T) => {
    pending = value;
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const next = pending;
      pending = undefined;
      if (next !== undefined) commit(next);
    });
  };
}
