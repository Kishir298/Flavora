/** Fail-closed profile parsing — safety-critical allergy handling.
 *
 * Corrupt allergies/avoidFoods JSON must NEVER silently become [] (which would
 * serve unsafe recipes). Display paths (GET /api/profile) may still return
 * safe defaults, but all safety-critical paths must throw/return 500
 * CORRUPT_PROFILE so the user resets instead of eating something unsafe.
 */

export function isCorruptJsonArray(raw: unknown): boolean {
  if (typeof raw !== "string") return true;
  try {
    const v = JSON.parse(raw);
    return !Array.isArray(v);
  } catch {
    return true;
  }
}

export function isCorruptJsonObject(raw: unknown): boolean {
  if (typeof raw !== "string") return true;
  try {
    const v = JSON.parse(raw);
    return !(v && typeof v === "object" && !Array.isArray(v));
  } catch {
    return true;
  }
}

/** True if safety-critical columns are corrupt. */
export function isSafetyProfileCorrupt(row: { allergies: unknown; avoidFoods: unknown }): boolean {
  return isCorruptJsonArray(row.allergies) || isCorruptJsonArray(row.avoidFoods);
}

export class CorruptProfileError extends Error {
  code = "CORRUPT_PROFILE";
  constructor() {
    super("profile safety data corrupt — reset profile before requesting recommendations");
  }
}

/** Throw CorruptProfileError if allergies/avoidFoods are corrupt. */
export function assertSafetyProfileValid(row: { allergies: unknown; avoidFoods: unknown }): void {
  if (isSafetyProfileCorrupt(row)) throw new CorruptProfileError();
}

/** Shared 500 response for corrupt safety data (fail-closed, no recipe data). */
export function corruptProfileResponse(res: { status: (n: number) => { json: (o: unknown) => void } }) {
  return res
    .status(500)
    .json({ error: "CORRUPT_PROFILE", message: "profile safety data corrupt — reset profile before continuing" });
}
