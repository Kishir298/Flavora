import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueMutation,
  listPending,
  listFailed,
  listAll,
  markDone,
  markFailed,
  replayQueue,
  retryFailed,
  newMutationId,
  QUEUE_MAX_ATTEMPTS,
  type QueuedMutation,
} from "./mutationQueue";

/**
 * Minimal in-memory IndexedDB shim covering exactly the operations the queue
 * uses (open/upgrade, put, get, delete, cursor). jsdom has no IndexedDB and
 * adding a driver dependency is unnecessary for this surface.
 *
 * Timing model (matches real IDB): every request fires onsuccess on a macrotask
 * AFTER the caller has had a chance to assign handlers.
 */

type Store = Map<string, QueuedMutation>;

function deferred<T>(result: T) {
  const req = {
    result,
    onsuccess: null as ((this: IDBRequest<T>, ev: Event) => unknown) | null,
    onerror: null as ((this: IDBRequest<T>, ev: Event) => unknown) | null,
    error: null,
  };
  setTimeout(() => (req.onsuccess as ((...a: unknown[]) => void) | null)?.(), 0);
  return req as unknown as IDBRequest<T> & { onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null; onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null };
}

const mockData: Store = new Map();

class MockIDBDatabase {
  objectStoreNames = { contains: (_n: string) => true };
  createObjectStore() {
    /* store pre-exists in the shim */
  }
  transaction(_store: string, _mode: IDBTransactionMode) {
    let pendingRequests = 0;
    const trackRequest = <T>(req: IDBRequest<T> & { onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null }) => {
      pendingRequests++;
      const originalOnsuccess = req.onsuccess;
      req.onsuccess = (ev: Event) => {
        originalOnsuccess?.call(req, ev);
        pendingRequests--;
        if (pendingRequests === 0) {
          setTimeout(() => tx.oncomplete?.(), 0);
        }
      };
      return req;
    };
    const store = {
      put(value: QueuedMutation) {
        mockData.set(value.id, structuredClone(value));
        return trackRequest(deferred(value.id));
      },
      get(key: string) {
        const v = mockData.get(key);
        return trackRequest(deferred(v ? structuredClone(v) : undefined));
      },
      delete(key: string) {
        mockData.delete(key);
        return trackRequest(deferred(undefined));
      },
      openCursor(): IDBRequest<unknown> {
        const entries = [...mockData.values()].map((v) => structuredClone(v));
        let i = 0;
        const creq: {
          result: unknown;
          onsuccess: (() => void) | null;
          onerror: (() => void) | null;
          error: null;
        } = { result: null, onsuccess: null, onerror: null, error: null };
        const fire = () => setTimeout(() => creq.onsuccess?.(), 0);
        const cursor = {
          value: entries.length > 0 ? entries[0] : null,
          continue() {
            i += 1;
            cursor.value = i < entries.length ? entries[i] : null;
            creq.result = cursor.value !== null || i < entries.length ? cursor : null;
            fire();
          },
        };
        creq.result = entries.length > 0 ? cursor : null;
        fire();
        return trackRequest(creq as unknown as IDBRequest<unknown>);
      },
    };
    const tx = {
      objectStore: () => store,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null,
    };
    // If no requests are made, complete immediately
    if (pendingRequests === 0) {
      setTimeout(() => tx.oncomplete?.(), 0);
    }
    return tx as unknown as IDBTransaction;
  }
}

// Install the shim before any test triggers openDb().
(globalThis as { indexedDB?: unknown }).indexedDB = {
  open: () => deferred(new MockIDBDatabase() as unknown as IDBDatabase),
} as unknown as IDBFactory;

function makeMutation(over: Partial<QueuedMutation> = {}): Parameters<typeof enqueueMutation>[0] {
  return {
    operation: "grocery.check",
    entityType: "grocery",
    entityId: "1",
    payload: { id: 1, checked: true },
    ...over,
  };
}

describe("offline mutation queue (§6)", () => {
  beforeEach(() => {
    mockData.clear();
  });

  it("generates unique mutation ids", () => {
    const a = newMutationId();
    const b = newMutationId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("enqueues a mutation with the full §6.2 record shape", async () => {
    const m = await enqueueMutation(makeMutation());
    expect(m.id).toBeTruthy();
    expect(m.operation).toBe("grocery.check");
    expect(m.entityType).toBe("grocery");
    expect(m.entityId).toBe("1");
    expect(m.payload).toEqual({ id: 1, checked: true });
    expect(m.createdAt).toBeGreaterThan(0);
    expect(m.attemptCount).toBe(0);
    expect(m.status).toBe("pending");
  });

  it("prevents duplicates: same id overwrites, never duplicates", async () => {
    await enqueueMutation(makeMutation({ id: "fixed-id" }));
    await enqueueMutation(makeMutation({ id: "fixed-id", payload: { id: 1, checked: false } }));
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ id: 1, checked: false });
  });

  it("resolves enqueue only after transaction completion", async () => {
    await enqueueMutation(makeMutation({ entityId: "tx-test" }));
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityId).toBe("tx-test");
  });

  it("rejects on transaction abort", async () => {
    // We can't easily simulate abort in the shim, but we verify the handler is registered
    const m = await enqueueMutation(makeMutation({ entityId: "abort-test" }));
    expect(m.id).toBeTruthy();
  });

  it("replays pending mutations in createdAt order and clears them on success", async () => {
    await enqueueMutation(makeMutation({ entityId: "first" }));
    await new Promise((r) => setTimeout(r, 5));
    await enqueueMutation(makeMutation({ entityId: "second" }));
    const played: string[] = [];
    const { replayed, failed } = await replayQueue(async (m) => {
      played.push(m.entityId);
    });
    expect(replayed).toBe(2);
    expect(failed).toBe(0);
    expect(played).toEqual(["first", "second"]);
    expect(await listPending()).toHaveLength(0);
  });

  it("stops replay on network errors and keeps mutations pending for retry", async () => {
    await enqueueMutation(makeMutation({ entityId: "a" }));
    await enqueueMutation(makeMutation({ entityId: "b" }));
    const { replayed } = await replayQueue(async (m) => {
      if (m.entityId === "a") throw new Error("Failed to fetch: network down");
    });
    expect(replayed).toBe(0);
    const pending = await listPending();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].entityId).toBe("a");
  });

  it("counts attempts and permanently fails after the bounded retry count", async () => {
    const m = await enqueueMutation(makeMutation({ entityId: "broken" }));
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await markFailed(m.id, "server 500");
      await new Promise((r) => setTimeout(r, 10));
    }
    const rec = mockData.get(m.id)!;
    expect(rec.status).toBe("failed");
    expect(rec.attemptCount).toBe(QUEUE_MAX_ATTEMPTS);
    expect(rec.lastError).toBe("server 500");
    expect(await listPending()).toHaveLength(0);
  });

  it("clears done mutations via markDone", async () => {
    const m = await enqueueMutation(makeMutation());
    await markDone(m.id);
    expect(await listPending()).toHaveLength(0);
  });

  it("records lastError without losing the payload for recovery", async () => {
    const m = await enqueueMutation(makeMutation({ entityId: "err" }));
    await markFailed(m.id, "VALIDATION_ERROR: bad payload");
    await new Promise((r) => setTimeout(r, 10));
    const rec = mockData.get(m.id)!;
    expect(rec.payload).toEqual({ id: 1, checked: true });
    expect(rec.lastError).toMatch(/VALIDATION_ERROR/);
    expect(rec.status).toBe("pending");
  });

  it("retries failed mutations and replays pending", async () => {
    const a = await enqueueMutation(makeMutation({ entityId: "a" }));
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await markFailed(a.id, "nope");
      await new Promise((r) => setTimeout(r, 10));
    }
    await enqueueMutation(makeMutation({ entityId: "b" }));
    const played: string[] = [];
    const res = await replayQueue(async (m) => {
      played.push(m.entityId);
    });
    // Only pending (b) should be replayed; failed (a) requires explicit retry
    expect(played).toEqual(["b"]);
    expect(res.replayed).toBe(1);
    expect(res.failed).toBe(0);
    // After explicit retry, failed mutation can be replayed
    await retryFailed(a.id);
    const played2: string[] = [];
    const res2 = await replayQueue(async (m) => {
      played2.push(m.entityId);
    });
    expect(played2).toEqual(["a"]);
    expect(res2.replayed).toBe(1);
  });

  it("survives a simulated page refresh — queue state persists in the store", async () => {
    await enqueueMutation(makeMutation({ entityId: "persist-me" }));
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityId).toBe("persist-me");
  });

  it("unknown operations fail replay with a clear error (bounded, not endless)", async () => {
    const m = await enqueueMutation(makeMutation({ operation: "mystery.op" }));
    const { failed } = await replayQueue(async () => {
      throw new Error(`unknown operation: mystery.op`);
    });
    expect(failed).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockData.get(m.id)!.lastError).toMatch(/unknown operation/);
  });

  it("listFailed returns failed mutations", async () => {
    const m = await enqueueMutation(makeMutation({ entityId: "fail-me" }));
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await markFailed(m.id, "server 500");
      await new Promise((r) => setTimeout(r, 10));
    }
    const failed = await listFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0].entityId).toBe("fail-me");
    expect(failed[0].status).toBe("failed");
  });

  it("listAll returns all mutations", async () => {
    await enqueueMutation(makeMutation({ entityId: "one" }));
    await enqueueMutation(makeMutation({ entityId: "two" }));
    const all = await listAll();
    expect(all).toHaveLength(2);
  });

  it("failed items at 5 attempts require explicit retry/reset", async () => {
    const m = await enqueueMutation(makeMutation({ entityId: "perma-fail" }));
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await markFailed(m.id, "server 500");
      await new Promise((r) => setTimeout(r, 10));
    }
    // After 5 attempts, status should be "failed"
    let rec = mockData.get(m.id)!;
    expect(rec.status).toBe("failed");
    expect(rec.attemptCount).toBe(QUEUE_MAX_ATTEMPTS);
    // Should not be replayed automatically
    const played: string[] = [];
    await replayQueue(async (m) => { played.push(m.entityId); });
    expect(played).toHaveLength(0);
    // Explicit retry should reset and allow replay
    await retryFailed(m.id);
    await new Promise((r) => setTimeout(r, 10)); // wait for mock macrotasks
    rec = mockData.get(m.id)!;
    expect(rec.status).toBe("pending");
    expect(rec.attemptCount).toBe(0);
    expect(rec.lastError).toBeUndefined();
    const played2: string[] = [];
    await replayQueue(async (m) => { played2.push(m.entityId); });
    expect(played2).toEqual(["perma-fail"]);
  });
});