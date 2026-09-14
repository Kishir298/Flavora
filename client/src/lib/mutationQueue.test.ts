import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueMutation,
  listPending,
  markDone,
  markFailed,
  replayQueue,
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

interface Firable {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function deferred<T>(result: T): IDBRequest<T> & { onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null } {
  const req: { result: T; onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null; onerror: ((this: IDBRequest<T>, ev: Event) => any) | null; error: null } = {
    result,
    onsuccess: null,
    onerror: null,
    error: null,
  };
  setTimeout(() => (req.onsuccess as ((...a: unknown[]) => void) | null)?.(), 0);
  return req as unknown as IDBRequest<T> & { onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null };
}

const mockData: Store = new Map();

class MockIDBDatabase {
  objectStoreNames = { contains: (_n: string) => true };
  createObjectStore() {
    /* store pre-exists in the shim */
  }
  transaction(_store: string, _mode: IDBTransactionMode) {
    const store = {
      put(value: QueuedMutation) {
        mockData.set(value.id, structuredClone(value));
        return deferred(value.id);
      },
      get(key: string) {
        const v = mockData.get(key);
        return deferred(v ? structuredClone(v) : undefined);
      },
      delete(key: string) {
        mockData.delete(key);
        return deferred(undefined);
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
          // Real IDB: request.result IS the cursor until exhausted, then null.
          value: entries.length > 0 ? entries[0] : null,
          continue() {
            i += 1;
            cursor.value = i < entries.length ? entries[i] : null;
            creq.result = cursor.value !== null || i < entries.length ? cursor : null;
            fire();
          },
        };
        creq.result = entries.length > 0 ? cursor : null; // exhausted cursor -> request.result is null
        fire();
        return creq as unknown as IDBRequest<unknown>;
      },
    };
    const tx = {
      objectStore: () => store,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      error: null,
    };
    setTimeout(() => tx.oncomplete?.(), 0);
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
    // replay stops at the first network failure to preserve ordered replay
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].entityId).toBe("a");
  });

  it("counts attempts and permanently fails after the bounded retry count", async () => {
    const m = await enqueueMutation(makeMutation({ entityId: "broken" }));
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await markFailed(m.id, "server 500");
      // let the shim's macrotask chain (put inside get handler) fully settle
      await new Promise((r) => setTimeout(r, 10));
    }
    const rec = mockData.get(m.id)!;
    expect(rec.status).toBe("failed");
    expect(rec.attemptCount).toBe(QUEUE_MAX_ATTEMPTS);
    expect(rec.lastError).toBe("server 500");
    // failed mutations are no longer replayed
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
    expect(rec.status).toBe("pending"); // 1 attempt < max, still retryable
  });

  it("skips permanently-failed mutations but replays the rest", async () => {
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
    expect(played).toEqual(["b"]);
    expect(res.replayed).toBe(1);
    expect(res.failed).toBe(0);
  });

  it("survives a simulated page refresh — queue state persists in the store", async () => {
    await enqueueMutation(makeMutation({ entityId: "persist-me" }));
    // "Refresh": a brand-new call sequence reads the same persistent store.
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
});
