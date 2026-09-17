import { enqueueMutation } from "./mutationQueue";

/** Offline helper for the meal log (server-side JSON store). */
export async function enqueueMealLog(
  op: "add" | "update" | "remove",
  payload: Record<string, unknown> & { id?: string }
) {
  return enqueueMutation({
    operation: `meallog.${op}`,
    entityType: "meallog",
    entityId: String(payload.id ?? payload.name ?? "new"),
    payload,
    ...(payload.id ? { id: `meallog-${op}-${payload.id}` } : {}),
  });
}
