import { describe, it, expect } from "vitest";
import {
  advanceConversation,
  createSession,
  isBareSlotAnswer,
  pendingSlot,
} from "./conversationService.js";

/**
 * Regression: live-UI conversational loop (prompt §2/§14).
 * Replays the exact observed transcript through the real state machine
 * (heuristic parse → merge → missing slots → next question) and asserts
 * structured state — never snapshots, never hardcoded food special-cases.
 * Varied foods/numbers are used so per-example cheats cannot pass.
 */
describe("conversation loop regression — observed transcript", () => {
  it("Test A: 'i want chicken' is retained, craving question forbidden", () => {
    const r = advanceConversation(undefined, "i want chicken");
    expect(r.done).toBe(false);
    expect(r.question).not.toBe("What are you craving today?");
    const req = r.session.request;
    expect(req.craving ?? req.availableIngredients).toBeTruthy();
    expect(JSON.stringify(req).toLowerCase()).toContain("chicken");
  });

  it("Test B: chicken + bare '600' are BOTH retained; calorie Q not repeated", () => {
    let r = advanceConversation(undefined, "I want chicken");
    const sid = r.session.id;
    r = advanceConversation(sid, "600");
    expect(r.session.request.calorieTarget).toBe(600);
    expect(JSON.stringify(r.session.request).toLowerCase()).toContain("chicken");
    if (!r.done) {
      expect(r.question).not.toMatch(/calories/i);
    }
  });

  it("Test C: 'actually vegetarian' corrects diet without losing craving", () => {
    let r = advanceConversation(undefined, "I want chicken");
    const sid = r.session.id;
    r = advanceConversation(sid, "actually vegetarian");
    expect(r.session.request.dietaryPreference).toBe("vegetarian");
    expect(JSON.stringify(r.session.request).toLowerCase()).toContain("chicken");
  });

  it("Test D: 'something healthy' + 'around 500 calories' both retained", () => {
    let r = advanceConversation(undefined, "I want something healthy");
    expect(r.question).not.toBe("What are you craving today?");
    const sid = r.session.id;
    r = advanceConversation(sid, "around 500 calories");
    expect(r.session.request.calorieTarget).toBe(500);
    expect(r.session.request.craving).toBeTruthy();
    if (!r.done) {
      expect(r.question).not.toMatch(/calories/i);
    }
  });

  it("Test E: 'hi' asks a first question; bare '500' never repeats calorie Q", () => {
    let r = advanceConversation(undefined, "hi");
    expect(r.done).toBe(false);
    expect(r.question).toBeTruthy();
    const firstQ = r.question as string;
    const sid = r.session.id;
    r = advanceConversation(sid, "500");
    if (!r.done) {
      // Either 500 was accepted as calories (question moves on) or the
      // assistant nudges without storing junk — but never the same Q twice
      // while claiming to have accepted the answer.
      if (r.session.request.calorieTarget === 500) {
        expect(r.question).not.toBe(firstQ);
      } else {
        expect(r.session.request.craving).not.toBe("500");
      }
    } else {
      expect(r.session.request.calorieTarget).toBe(500);
    }
  });

  it("junk ('what', '20') never clobbers established food state", () => {
    let r = advanceConversation(undefined, "I want beef pasta");
    const sid = r.session.id;
    const before = { ...r.session.request };
    r = advanceConversation(sid, "what");
    expect(r.session.request.craving).toBe(before.craving);
    expect(r.session.request.availableIngredients).toEqual(before.availableIngredients);
    r = advanceConversation(r.session.id, "20");
    // 20 is out of calorie range: must not become the craving either.
    expect(r.session.request.craving).toBe(before.craving);
  });

  it("'actually beef' replaces the craving; diet-only corrections keep it", () => {
    let r = advanceConversation(undefined, "I want pasta");
    const sid = r.session.id;
    r = advanceConversation(sid, "actually beef");
    expect(r.session.request.craving).toBe("beef");
    expect(r.session.request.availableIngredients).toEqual(["beef"]);

    r = advanceConversation(undefined, "I want salmon");
    const sid2 = r.session.id;
    r = advanceConversation(sid2, "actually vegetarian");
    expect(r.session.request.dietaryPreference).toBe("vegetarian");
    expect(r.session.request.craving).toBe("salmon");
  });

  it("bare numbers only fill the pending numeric slot; otherwise no pollution", () => {
    // "4" with no numeric question pending: nothing set, nothing clobbered.
    let r = advanceConversation(undefined, "I want lentil soup");
    const sid = r.session.id;
    r = advanceConversation(sid, "4");
    expect(r.session.request.servings).toBeUndefined();
    expect(r.session.request.calorieTarget).toBeUndefined();
    expect(JSON.stringify(r.session.request).toLowerCase()).toContain("lentil");
    // Out-of-range bare number for the pending calorie slot: guidance
    // repeats the question with a range hint, craving stays intact.
    let c = advanceConversation(undefined, "I want mushroom pasta");
    c = advanceConversation(c.session.id, "20");
    expect(c.session.request.calorieTarget).toBeUndefined();
    expect(c.done).toBe(false);
    expect(c.question).toMatch(/calories/i);
    expect(c.question).toMatch(/50.*5000/);
    expect(JSON.stringify(c.session.request).toLowerCase()).toContain("mushroom");
    // Time: fresh flow, answer the time question bare (pending slot decides).
    let t = advanceConversation(undefined, "I want mushroom pasta");
    t = advanceConversation(t.session.id, "600");
    t = advanceConversation(t.session.id, "non-veg");
    t = advanceConversation(t.session.id, "rice and mushrooms");
    t = advanceConversation(t.session.id, "dinner");
    // By now the flow is done or asking servings/time — bare "25" must never
    // become a craving regardless of which slot is pending.
    t = advanceConversation(t.session.id, "25");
    expect(t.session.request.craving).not.toBe("25");
    expect(JSON.stringify(t.session.request)).not.toContain('"craving":"25"');
  });

  it("sessions are isolated; New-Chat-equivalent sessions start clean", () => {
    const a = advanceConversation(undefined, "I want chicken");
    const b = advanceConversation(undefined, "I want beef pasta");
    expect(a.session.id).not.toBe(b.session.id);
    expect(JSON.stringify(b.session.request).toLowerCase()).not.toContain("chicken");
    // A fresh session (what New Chat creates server-side) carries no requirements.
    const fresh = createSession({});
    expect(fresh.request).toEqual({});
  });

  it("Test 3: 100000 rejected with guidance, pending stays calorieTarget", () => {
    let r = advanceConversation(undefined, "I want turkey");
    const sid = r.session.id;
    r = advanceConversation(sid, "100000");
    expect(r.done).toBe(false);
    expect(r.session.request.calorieTarget).toBeUndefined();
    expect(r.session.request.craving).toContain("turkey");
    expect(r.question).toMatch(/calories/i);
    expect(r.question).toMatch(/50.*5000/);
    expect(pendingSlot(r.session.request)).toBe("calorieTarget");
  });

  it("Test 4: valid calorie after invalid calorie advances", () => {
    let r = advanceConversation(undefined, "I want turkey");
    const sid = r.session.id;
    r = advanceConversation(sid, "100000");
    r = advanceConversation(r.session.id, "500");
    expect(r.session.request.calorieTarget).toBe(500);
    expect(r.session.request.craving).toContain("turkey");
    if (!r.done) expect(r.question).not.toMatch(/calories/i);
  });

  it("Test 5: chicken → 500 → non-veg retains everything", () => {
    let r = advanceConversation(undefined, "I want chicken");
    const sid = r.session.id;
    r = advanceConversation(sid, "500");
    r = advanceConversation(r.session.id, "non-veg");
    expect(r.session.request.craving).toContain("chicken");
    expect(r.session.request.calorieTarget).toBe(500);
    expect(r.session.request.dietaryPreference).toBe("non-vegetarian");
  });

  it("Test 6: greeting while pending keeps slot; later answer fills it", () => {
    let r = advanceConversation(undefined, "I want salmon");
    expect(r.question).toMatch(/calories/i);
    const sid = r.session.id;
    r = advanceConversation(sid, "hi");
    // Greeting neither satisfies nor corrupts: still pending calories.
    expect(r.done).toBe(false);
    expect(pendingSlot(r.session.request)).toBe("calorieTarget");
    expect(r.session.request.craving).toContain("salmon");
    expect(r.question).toMatch(/calories/i);
    r = advanceConversation(r.session.id, "500");
    expect(r.session.request.calorieTarget).toBe(500);
  });

  it("Test 7: unrelated text preserves state for the real answer", () => {
    let r = advanceConversation(undefined, "I want salmon");
    const sid = r.session.id;
    r = advanceConversation(sid, "what");
    expect(r.session.request.craving).toContain("salmon");
    expect(r.session.request.calorieTarget).toBeUndefined();
    r = advanceConversation(r.session.id, "500");
    expect(r.session.request.calorieTarget).toBe(500);
    expect(r.session.request.craving).toContain("salmon");
  });

  it("Test 8: vegetarian → actually non-veg ends non-veg", () => {
    let r = advanceConversation(undefined, "I want lentils");
    const sid = r.session.id;
    r = advanceConversation(sid, "450");
    r = advanceConversation(r.session.id, "vegetarian");
    expect(r.session.request.dietaryPreference).toBe("vegetarian");
    r = advanceConversation(r.session.id, "actually non-veg");
    expect(r.session.request.dietaryPreference).toBe("non-vegetarian");
    expect(r.session.request.craving).toContain("lentils");
    expect(r.session.request.calorieTarget).toBe(450);
  });

  it("turn cap completes long junk sessions (the 'umm chicken' mechanism)", () => {
    const s = createSession({});
    let r = advanceConversation(s.id, "hello");
    for (const msg of ["hi", "umm", "what", "hey", "yo"]) {
      r = advanceConversation(r.session.id, msg);
      if (r.done) break;
    }
    // Six turns without satisfiable answers force completion instead of an
    // infinite question loop; junk never became a requirement.
    expect(r.done).toBe(true);
    expect(r.session.request.craving ?? "").not.toMatch(/^(hi|hey|yo|what|umm|hello)$/i);
  });

  it("pendingSlot + isBareSlotAnswer contract", () => {
    expect(pendingSlot({})).toBe("craving");
    expect(pendingSlot({ craving: "chicken" })).toBe("calorieTarget");
    expect(isBareSlotAnswer("500", "calorieTarget")).toBe(true);
    expect(isBareSlotAnswer("100000", "calorieTarget")).toBe(false);
    expect(isBareSlotAnswer("non veg", "dietaryPreference")).toBe(true);
    expect(isBareSlotAnswer("dinner", "mealType")).toBe(true);
    expect(isBareSlotAnswer("italian", "cuisine")).toBe(true);
    expect(isBareSlotAnswer("vegetarian dinner", "dietaryPreference")).toBe(false);
    expect(isBareSlotAnswer("500", "craving")).toBe(false);
    expect(isBareSlotAnswer("dinner", "calorieTarget")).toBe(false);
    expect(isBareSlotAnswer("hi", undefined)).toBe(false);
  });
});
