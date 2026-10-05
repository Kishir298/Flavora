/** Offline mutation queue (§6). IndexedDB persistent, no new deps. */
export type MutationStatus = "pending" | "failed" | "done";
export interface QueuedMutation {
  id: string;
  operation: string; // e.g. "grocery.check", "inventory.add", "meal.add", "interact", "sub.apply"
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attemptCount: number;
  status: MutationStatus;
  lastError?: string;
}

const DB = "flavora-queue";
const STORE = "mutations";
const MAX_ATTEMPTS = 5;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out: T[] = [];
    if (mode === "readonly") {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) { out.push(c.value); c.continue(); }
        else resolve(out);
      };
      cursor.onerror = () => reject(cursor.error);
    } else {
      try { fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("Transaction aborted"));
    }
  });
}

export function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueMutation(m: Omit<QueuedMutation, "id" | "createdAt" | "attemptCount" | "status"> & { id?: string }): Promise<QueuedMutation> {
  const full: QueuedMutation = {
    id: m.id ?? newMutationId(),
    createdAt: Date.now(), attemptCount: 0, status: "pending",
    operation: m.operation, entityType: m.entityType, entityId: m.entityId, payload: m.payload,
  };
  await tx("readwrite", (store) => {
    store.put(full);
  });
  // duplicate prevention: put by id overwrites — same id never duplicates
  return full;
}

export async function listPending(): Promise<QueuedMutation[]> {
  const all = await tx<QueuedMutation>("readonly", () => {});
  return all.filter((m) => m.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
}

export async function listFailed(): Promise<QueuedMutation[]> {
  const all = await tx<QueuedMutation>("readonly", () => {});
  return all.filter((m) => m.status === "failed").sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAll(): Promise<QueuedMutation[]> {
  const all = await tx<QueuedMutation>("readonly", () => {});
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function markDone(id: string): Promise<void> {
  await tx("readwrite", (store) => {
    store.delete(id);
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  await tx("readwrite", (store) => {
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as QueuedMutation | undefined;
      if (!cur) return;
      cur.attemptCount += 1;
      cur.lastError = error.slice(0, 500);
      if (cur.attemptCount >= MAX_ATTEMPTS) cur.status = "failed";
      store.put(cur);
    };
    get.onerror = () => { throw get.error; };
  });
}

export async function retryFailed(id: string): Promise<void> {
  await tx("readwrite", (store) => {
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as QueuedMutation | undefined;
      if (!cur) return;
      cur.status = "pending";
      cur.attemptCount = 0;
      cur.lastError = undefined;
      store.put(cur);
    };
    get.onerror = () => { throw get.error; };
  });
}

export async function retryAllFailed(): Promise<number> {
  const failed = await listFailed();
  for (const m of failed) {
    await retryFailed(m.id);
  }
  return failed.length;
}

/** Shared offline detector: fetch TypeErrors differ per browser (Safari: "Load failed"). */
export function isNetworkError(msg: string): boolean {
  return /failed to fetch|network|offline|load failed|fetch failed|aborted/i.test(msg);
}
/**
 * Replay pending mutations in order using the provided executor.
 * Executor should throw on failure. Stops on first network-unavailable error.
 * Failed mutations (at MAX_ATTEMPTS) are NOT replayed automatically — they require explicit retry/reset.
 */
export async function replayQueue(exec: (m: QueuedMutation) => Promise<void>): Promise<{ replayed: number; failed: number }> {
  const pending = await listPending();
  let replayed = 0, failed = 0;
  for (const m of pending) {
    try {
      await exec(m);
      await markDone(m.id);
      replayed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // offline/network errors: stop, keep pending for later
      if (isNetworkError(msg)) break;
      await markFailed(m.id, msg);
      failed++;
    }
  }
  return { replayed, failed };
}

export const QUEUE_MAX_ATTEMPTS = MAX_ATTEMPTS;
