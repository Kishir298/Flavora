import { useEffect, useState, useSyncExternalStore } from "react";
import { listAll, replayQueue, type QueuedMutation } from "./mutationQueue";
import { api } from "./api";

export type SyncState = "synchronized" | "pending" | "syncing" | "failed";

// Module-level singleton: one online listener + one poll interval no matter
// how many components call useOnlineStatus(). Previously each instance
// started its own 3s poll + auto-sync, causing N concurrent replayQueue runs.
interface SharedState { online: boolean; pending: number; syncState: SyncState }
let shared: SharedState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
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
    shared = {
      ...shared,
      pending: pending.length,
      syncState: all.some((m) => m.status === "failed") ? "failed" : pending.length ? "pending" : "synchronized",
    };
    emit();
  } catch { /* indexeddb unavailable in tests */ }
}

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
  setInterval(() => void refreshShared(), 3000);
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
  return { online: snap.online, pending: snap.pending, syncState: snap.syncState, syncNow: syncNowShared };
}

/** Exported for tests: replay a single queued mutation against the API. */
export async function executeMutation(m: QueuedMutation): Promise<void> {  const p = m.payload as Record<string, unknown>;
  switch (m.operation) {
    case "interact":
      await api.interact(String(p.recipeId), String(p.action));
      break;
    case "grocery.check":
      await api.updateGrocery(Number(p.id), { checked: Boolean(p.checked) });
      break;
    case "grocery.add":
      await api.addGrocery({ name: String(p.name), quantity: p.quantity as number | null, unit: p.unit as string | null, note: p.note as string | undefined, category: p.category as string | undefined });
      break;
    case "grocery.update":
      await api.updateGrocery(Number(p.id), p as { checked?: boolean; quantity?: number | null; unit?: string | null; note?: string });
      break;
    case "grocery.remove":
      await api.removeGrocery(Number(p.id), Boolean(p.restore));
      break;
    case "grocery.clearCompleted":
      await api.clearGroceryCompleted();
      break;
    case "inventory.add":
      await api.addInventory({ name: String(p.name), quantity: p.quantity as number | null, unit: p.unit as string | null, expiryDate: p.expiryDate as string | undefined });
      break;
    case "inventory.consume":
      await api.consumeInventory(Number(p.id), p.amount as number | undefined);
      break;
    case "inventory.update":
      await api.updateInventory(Number(p.id), p as { name?: string; quantity?: number | null; unit?: string | null; expiryDate?: string | null; notes?: string });
      break;
    case "inventory.remove":
      await api.removeInventory(Number(p.id));
      break;
    case "sub.apply":
      await api.applySub({ recipeId: String(p.recipeId), originalName: String(p.originalName), replacementName: String(p.replacementName), quantity: p.quantity as number | null, unit: p.unit as string | null });
      break;
    case "sub.revert":
      await api.revertSub({ recipeId: String(p.recipeId), originalName: String(p.originalName) });
      break;
    case "meal.add":
      await api.addMeal({ day: String(p.day), meal: String(p.meal), recipeId: String(p.recipeId), servings: p.servings as number | undefined });
      break;
    case "meal.remove":
      await api.removeMeal(Number(p.id));
      break;
    case "meal.update":
      await api.updateMeal(Number(p.id), p as { day?: string; meal?: string; servings?: number; recipeId?: string });
      break;
    case "meal.clearDay":
      await api.clearMealDay(String(p.day));
      break;
    case "meallog.add": {
      const { id: _drop, ...body } = p;
      await api.mealLog.add(body as Parameters<typeof api.mealLog.add>[0]);
      break;
    }
    case "meallog.update":
      await api.mealLog.update(String(p.id), p as Parameters<typeof api.mealLog.update>[1]);
      break;
    case "meallog.remove":
      await api.mealLog.remove(String(p.id));
      break;
    case "water.add":
      await api.addWater(Number(p.ml));
      break;
    case "goals.save": {
      const { ...body } = p;
      await api.saveGoals(body as Parameters<typeof api.saveGoals>[0]);
      break;
    }
    case "profile.save": {
      const { ...body } = p;
      await api.saveProfile(body as Parameters<typeof api.saveProfile>[0]);
      break;
    }
    default:
      throw new Error(`unknown operation: ${m.operation}`);
  }
}
