import { describe, it, expect } from "vitest";
import {
  advanceConversation,
  createSession,
  foodRequestToIntent,
  mergeModelGapFill,
  mergeRequest,
  missingSlots,
  parseTurn,
} from "./conversationService.js";
import { normalizeIntent } from "./intentSchema.js";

describe("conversation — full user journey", () => {
  it("chicken request → asks only missing info (calories first)", () => {
    const { session, question, done } = advanceConversation(undefined, "I want something with chicken");
    expect(done).toBe(false);
    expect(question).toMatch(/calories/i);
    expect(session.request.craving || session.request.availableIngredients?.length).toBeTruthy();
  });

  it("multi-field answer extracts everything at once", () => {
    const intent = parseTurn("About 600 calories, non-veg, chicken rice onions and peppers, for dinner");
    const merged = mergeRequest({}, intent, "About 600 calories, non-veg, chicken rice onions and peppers, for dinner");
    expect(merged.calorieTarget).toBe(600);
    expect(merged.dietaryPreference).toBe("non-vegetarian");
    expect(merged.mealType).toBe("dinner");
    expect(merged.availableIngredients?.length).toBeGreaterThanOrEqual(3);
  });

  it("does not re-ask known slots", () => {
    const missing = missingSlots({
      craving: "chicken dinner",
      mealType: "dinner",
      dietaryPreference: "vegetarian",
      availableIngredients: ["rice"],
      calorieTarget: 600,
    });
    expect(missing).toEqual([]);
  });

  it("corrections: latest explicit instruction wins", () => {
    let req = mergeRequest({}, parseTurn("Make it non-vegetarian"), "Make it non-vegetarian");
    expect(req.dietaryPreference).toBe("non-vegetarian");
    req = mergeRequest(req, parseTurn("Actually, make it vegetarian"), "Actually, make it vegetarian");
    expect(req.dietaryPreference).toBe("vegetarian");
  });

  it("skip/unknown never wipes known state", () => {
    const req = mergeRequest(
      { dietaryPreference: "vegetarian", calorieTarget: 500 },
      parseTurn("I don't care, whatever"),
      "I don't care, whatever"
    );
    expect(req.dietaryPreference).toBe("vegetarian");
    expect(req.calorieTarget).toBe(500);
  });

  it("completes and maps to engine intent", () => {
    const s = createSession({});
    let r = advanceConversation(s.id, "I want something with chicken");
    r = advanceConversation(r.session.id, "Around 600 calories, non-veg, chicken rice onions and peppers");
    r = advanceConversation(r.session.id, "Dinner");
    expect(r.done).toBe(true);
    const intent = foodRequestToIntent(r.session.request);
    expect(intent.availableIngredients?.length).toBeGreaterThan(0);
    expect(r.session.request.mealType).toBe("dinner");
  });

  it("safety exclusions are additive-only across turns", () => {
    let req = mergeRequest({}, parseTurn("I am allergic to peanuts"), "I am allergic to peanuts");
    req = mergeRequest(req, parseTurn("no mushrooms please"), "no mushrooms please");
    expect(req.allergies).toContain("peanuts");
    expect(req.avoidFoods).toContain("mushrooms");
  });

  it("model gap-fill never overrides explicit text or invents ingredients", () => {
    // Model hallucinates milk/garlic the user never mentioned; explicit
    // heuristic state (600, non-veg) must survive.
    const prev = {
      calorieTarget: 600,
      dietaryPreference: "non-vegetarian" as const,
      availableIngredients: ["chicken", "rice", "onions"],
    };
    const out = mergeModelGapFill(
      prev,
      { availableIngredients: ["chicken", "milk", "garlic"], mode: "normal" },
      "Around 600 calories, non-veg, chicken rice and onions"
    );
    expect(out.calorieTarget).toBe(600);
    expect(out.dietaryPreference).toBe("non-vegetarian");
    expect(out.availableIngredients).toContain("chicken");
    expect(out.availableIngredients).not.toContain("milk");
    expect(out.availableIngredients).not.toContain("garlic");
  });

  it("grounded model safety: unmentioned model allergies are dropped", () => {
    const s = createSession({});
    const r = advanceConversation(s.id, "I want chicken and rice", {
      parsedIntent: { allergies: ["garlic"], mode: "normal" },
    });
    expect(r.session.request.allergies ?? []).not.toContain("garlic");
  });

  it("sessions are isolated (concurrent ids don't share state)", () => {
    const a = advanceConversation(undefined, "I want chicken");
    const b = advanceConversation(undefined, "I want vegetarian pasta");
    expect(a.session.id).not.toBe(b.session.id);
    expect(a.session.request).not.toEqual(b.session.request);
  });

  it("forces done after 6 turns (never interrogates forever)", () => {
    const s = createSession({});
    let r = { session: s, question: "q", done: false } as unknown as ReturnType<typeof advanceConversation>;
    for (let i = 0; i < 6; i++) {
      r = advanceConversation(r.session.id, "whatever");
    }
    expect(r.done).toBe(true);
  });

  it("preserves explicit budget mode into engine intent", () => {
    const intent = foodRequestToIntent(
      { availableIngredients: ["rice"], craving: "cheap dinner" },
      "budget"
    );
    expect(intent.mode).toBe("budget");
  });

  it("dessert mealType normalizes to snack (never dropped)", () => {
    const out = normalizeIntent({ mealType: "dessert" });
    expect(out.mealType).toBe("snack");
    expect(out.foodRequest?.mealType).toBe("snack");
  });
});
