import { useEffect, useSyncExternalStore } from "react";
import { listAll, listFailed, replayQueue, retryAllFailed, type QueuedMutation } from "./mutationQueue";
import { api } from "./api";

export type SyncState = "synchronized" | "pending" | "syncing" | "failed";

// Module-level singleton: one online listener + one poll interval no matter
// how many components call useOnlineStatus(). Previously each instance
// started its own 3s poll + auto-sync, causing N concurrent replayQueue runs.
interface SharedState { online: boolean; pending: number; failed: number; syncState: SyncState }
let shared: SharedState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
  failed: 0,
  syncState: "synchronized",
};
const listeners = new Set<() => void>();
let started = false;
let syncInFlight = false;

function emit() {
  for (const l of listeners) l();
}

async function refreshShared() {
  try {
    const all = await listAll();
    const pending = all.filter((m) => m.status === "pending");
    const failed = all.filter((m) => m.status === "failed");
    shared = {
      ...shared,
      pending: pending.length,
      failed: failed.length,
      syncState: failed.length ? "failed" : pending.length ? "pending" : "synchronized",
    };
    emit();
  } catch { /* indexeddb unavailable in tests */ }
}

let pollId: ReturnType<typeof setInterval> | null = null;
function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => {
    shared = { ...shared, online: true };
    emit();
    void syncNowShared().catch(() => {});
  });
  window.addEventListener("offline", () => {
    shared = { ...shared, online: false };
    emit();
  });
  void refreshShared();
  if (pollId == null) {
    const startPoll = () => {
      if (pollId != null) return;
      pollId = setInterval(() => {
        // Pause churn when tab hidden; resume on visible.
        if (typeof document !== "undefined" && document.hidden) return;
        void refreshShared();
      }, 3000);
    };
    startPoll();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void refreshShared();
      });
    }
  }
}
/** Test/HMR cleanup: stop the shared 3s poll. */
export function stopOnlinePollForTests() {
  if (pollId != null) clearInterval(pollId);
  pollId = null;
  started = false;
}

async function syncNowShared() {
  if (syncInFlight) return;
  syncInFlight = true;
  shared = { ...shared, syncState: "syncing" };
  emit();
  try {
    await replayQueue(async (m: QueuedMutation) => {
      await executeMutation(m);
    });
  } finally {
    syncInFlight = false;
    await refreshShared();
  }
}

/** Online/offline + pending-sync status (§6.1): online | offline | pending | syncing | synchronized | failed. */
export function useOnlineStatus() {
  ensureStarted();
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => shared,
    () => shared
  );
  useEffect(() => {
    if (snap.online) void syncNowShared().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.online]);
  return { online: snap.online, pending: snap.pending, failed: snap.failed, syncState: snap.syncState, syncNow: syncNowShared, retryFailed: retryAllFailed };
}

/** Exported for tests: replay a single queued mutation against the API. */
export async function executeMutation(m: QueuedMutation): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _p = m.payload as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _idempotencyKey = m.id;
  switch (m.operation) {
    case "interact":
      await api.interact(String(_p.recipeId), String(_p.action));
      break;
    case "grocery.check":
      await api.updateGrocery(Number(_p.id), { checked: Boolean(_p.checked) });
      break;
    case "grocery.add":
      await api.addGrocery({ name: String(_p.name), quantity: _p.quantity as number | null, unit: _p.unit as string | null, note: _p.note as string | undefined, category: _p.category as string | undefined });
      break;
    case "grocery.update":
      await api.updateGrocery(Number(_p.id), _p as { checked?: boolean; quantity?: number | null; unit?: string | null; note?: string });
      break;
    case "grocery.remove":
      await api.removeGrocery(Number(_p.id), Boolean(_p.restore));
      break;
    case "grocery.clearCompleted":
      await api.clearGroceryCompleted();
      break;
    case "inventory.add":
      await api.addInventory({ name: String(_p.name), quantity: _p.quantity as number | null, unit: _p.unit as string | null, expiryDate: _p.expiryDate as string | undefined });
      break;
    case "inventory.consume":
      await api.consumeInventory(Number(_p.id), _p.amount as number | undefined);
      break;
    case "inventory.update":
      await api.updateInventory(Number(_p.id), _p as { name?: string; quantity?: number | null; unit?: string | null; expiryDate?: string | null; notes?: string });
      break;
    case "inventory.remove":
      await api.removeInventory(Number(_p.id));
      break;
    case "sub.apply":
      await api.applySub({ recipeId: String(_p.recipeId), originalName: String(_p.originalName), replacementName: String(_p.replacementName), quantity: _p.quantity as number | null, unit: _p.unit as string | null });
      break;
    case "sub.revert":
      await api.revertSub({ recipeId: String(_p.recipeId), originalName: String(_p.originalName) });
      break;
    case "meal.add":
      await api.addMeal({ day: String(_p.day), meal: String(_p.meal), recipeId: String(_p.recipeId), servings: _p.servings as number | undefined });
      break;
    case "meal.remove":
      await api.removeMeal(Number(_p.id));
      break;
    case "meal.update":
      await api.updateMeal(Number(_p.id), _p as { day?: string; meal?: string; servings?: number; recipeId?: string });
      break;
    case "meal.clearDay":
      await api.clearMealDay(String(_p.day));
      break;
    case "meallog.add": {
      const { id: _drop, ...body } = _p;
      await api.mealLog.add(body as Parameters<typeof api.mealLog.add>[0], _idempotencyKey);
      break;
    }
    case "meallog.update":
      await api.mealLog.update(String(_p.id), _p as Parameters<typeof api.mealLog.update>[1], _idempotencyKey);
      break;
    case "meallog.remove":
      await api.mealLog.remove(String(_p.id), _idempotencyKey);
      break;
    case "water.add":
      await api.addWater(Number(_p.ml), _idempotencyKey, _p.loggedAt as string | undefined);
      break;
    case "goals.save": {
      const { ...body } = _p;
      await api.saveGoals(body as Parameters<typeof api.saveGoals>[0], _idempotencyKey);
      break;
    }
    case "profile.save": {
      const { ...body } = _p;
      await api.saveProfile(body as Parameters<typeof api.saveProfile>[0], _idempotencyKey);
      break;
    }
    default:
      throw new Error(`unknown operation: ${m.operation}`);
  }
}
