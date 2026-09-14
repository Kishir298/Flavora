import { useEffect, useState } from "react";
import { listPending, replayQueue, type QueuedMutation } from "./mutationQueue";
import { api } from "./api";

export type SyncState = "synchronized" | "pending" | "syncing" | "failed";

/** Online/offline + pending-sync status (§6.1): online | offline | pending | syncing | synchronized | failed. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synchronized");

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const p = await listPending();
        if (!cancelled) {
          setPending(p.length);
          setSyncState(p.some((m) => m.status === "failed") ? "failed" : p.length ? "pending" : "synchronized");
        }
      } catch { /* indexeddb unavailable in tests */ }
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const syncNow = async () => {
    setSyncState("syncing");
    try {
      const { replayed } = await replayQueue(async (m: QueuedMutation) => {
        await executeMutation(m);
      });
      void replayed;
    } finally {
      const p = await listPending().catch(() => []);
      setPending(p.length);
      const hasFailed = p.some((m) => m.status === "failed");
      setSyncState(hasFailed ? "failed" : p.length ? "pending" : "synchronized");
    }
  };

  useEffect(() => {
    if (online) syncNow().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return { online, pending, syncState, syncNow };
}

async function executeMutation(m: QueuedMutation): Promise<void> {
  const p = m.payload as Record<string, unknown>;
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
    case "meal.clearDay":
      await api.clearMealDay(String(p.day));
      break;
    default:
      throw new Error(`unknown operation: ${m.operation}`);
  }
}
