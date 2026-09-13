/**
 * Expiry config + helpers (Steps 5-6, 10). Single source of threshold.
 * Dates are user-entered estimates — never presented as food-safety facts.
 */
export const EXPIRY_THRESHOLD_DAYS = 2;

export function expiryStatus(expiryDate, now = new Date()) {
  if (!expiryDate) return "unknown";
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= EXPIRY_THRESHOLD_DAYS) return "expiring_soon";
  return "fresh";
}

export function expiryLabel(expiryDate, now = new Date()) {
  if (!expiryDate) return "No expiry recorded";
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return "No expiry recorded";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} ago`;
  if (diffDays === 0) return "Expires today";
  return `Expires in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
}

/** Estimate language for UI — never a safety claim. */
export function expiryReason(name) {
  return `Uses ${name}, which you marked as expiring soon`;
}
