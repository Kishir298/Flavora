import { describe, it, expect } from "vitest";
import {
  advanceConversation,
  createSession,
  foodRequestToIntent,
  getSession,
  mergeModelGapFill,
  mergeRequest,
  missingSlots,
  parseTurn,
} from "./conversationService.js";
import { normalizeIntent } from "./intentSchema.js";
import { fuzzyFood, parseIntentHeuristic } from "./heuristicParser.js";

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

  // Regression: inputs carrying food info must advance the conversation,
  // never loop on the initial craving question.
  const LOOP_CASES: [string, (req: Record<string, unknown>) => void][] = [
    ["i want chicken", (req) => {
      expect(req.craving ?? req.availableIngredients).toBeTruthy();
    }],
    ["i want dih", (req) => {
      expect(req.craving).toBeTruthy();
    }],
    ["i want chickewn maska", (req) => {
      expect(req.craving).toBeTruthy();
    }],
    ["I want something healthy", (req) => {
      expect(req.craving).toBeTruthy();
    }],
    ["I want chicken for dinner", (req) => {
      expect(req.mealType).toBe("dinner");
      expect(req.craving ?? req.availableIngredients).toBeTruthy();
    }],
    ["I have chicken rice and onions", (req) => {
      expect((req.availableIngredients as string[] | undefined)?.length).toBeGreaterThanOrEqual(2);
    }],
  ];
  for (const [msg, check] of LOOP_CASES) {
    it(`advances on ${JSON.stringify(msg)} (no craving loop)`, () => {
      const r = advanceConversation(undefined, msg);
      check(r.session.request as Record<string, unknown>);
      // Either done or a follow-up that is NOT the initial prompt.
      if (!r.done) expect(r.question).not.toBe("What are you craving today?");
    });
  }

  // Slot-only messages carry no food info: capturing the slot while (correctly)
  // asking what they're craving is NOT a loop — state progressed.
  it("captures slots from food-less messages without wiping state", () => {
    const cal = advanceConversation(undefined, "I want something around 600 calories");
    expect(cal.session.request.calorieTarget).toBe(600);
    const diet = advanceConversation(undefined, "I want a vegetarian dinner");
    expect(diet.session.request.dietaryPreference).toBe("vegetarian");
    expect(diet.session.request.mealType).toBe("dinner");
    // …and a follow-up naming food then advances past craving.
    const next = advanceConversation(diet.session.id, "chicken please");
    expect(next.session.request.dietaryPreference).toBe("vegetarian");
    if (!next.done) expect(next.question).not.toBe("What are you craving today?");
  });

  it("full acceptance journey: chicken → calories+diet → ingredients+meal → done", () => {
    let r = advanceConversation(undefined, "I want chicken.");
    expect(r.question).toMatch(/calories/i);
    r = advanceConversation(r.session.id, "Around 600 calories, non-veg.");
    expect(r.done).toBe(false);
    expect(r.session.request.calorieTarget).toBe(600);
    r = advanceConversation(r.session.id, "Chicken, rice and onions. Dinner.");
    expect(r.done).toBe(true);
    expect(r.session.request.mealType).toBe("dinner");
    const intent = foodRequestToIntent(r.session.request);
    expect(intent.availableIngredients?.length).toBeGreaterThan(0);
  });
});

describe("conservative typo tolerance (craving/ingredients only, safety exact)", () => {
  it("resolves distance-1 typos to known foods", () => {
    expect(fuzzyFood("chickewn")).toBe("chicken");
    expect(fuzzyFood("garlik")).toBe("garlic");
    expect(fuzzyFood("cheeze")).toBe("cheese");
  });

  it("refuses short, distant, multi-word, or ambiguous inputs", () => {
    expect(fuzzyFood("dih")).toBeNull(); // too short — stays free-text
    expect(fuzzyFood("maska")).toBeNull(); // too far from anything
    expect(fuzzyFood("chicken curry")).toBeNull(); // phrases never fuzzy-matched
    expect(fuzzyFood("peanut")).toBe("peanut"); // exact words pass through
  });

  it("seeds typo-resolved ingredients while keeping raw craving text", () => {
    const r = advanceConversation(undefined, "i want chickewn maska");
    expect(r.session.request.availableIngredients).toContain("chicken");
    expect(r.session.request.craving).toBe("chickewn maska");
    if (!r.done) expect(r.question).not.toBe("What are you craving today?");
  });

  it("safety extractors stay exact — typo allergies are never invented", () => {
    const out = parseIntentHeuristic("allergic to penut");
    // The raw token is preserved (never fuzzy-resolved into a real allergy),
    // so the deterministic filter treats it as written — no invented allergy.
    expect(out.allergies).toEqual(["penut"]);
    expect(fuzzyFood("penut")).toBe("peanut"); // resolver exists…
    // …but the allergy path does not use it (assert via no silent mapping):
    const out2 = parseIntentHeuristic("allergic to peanuts");
    expect(out2.allergies).toContain("peanuts");
  });
});

describe("conversation — session TTL expiry", () => {
  it("expired sessions read as undefined and resuming starts fresh", () => {
    const s = createSession({ craving: "chicken" });
    expect(getSession(s.id)?.id).toBe(s.id);
    // Force expiry by backdating updatedAt past the 30min TTL.
    s.updatedAt = Date.now() - 31 * 60 * 1000;
    expect(getSession(s.id)).toBeUndefined();
    const r = advanceConversation(s.id, "600 calories");
    expect(r.session.id).not.toBe(s.id);
    expect(r.reset).toBe(true);
  });
  it("unknown session ids start a fresh session with reset flag", () => {
    const r = advanceConversation("does-not-exist", "hi");
    expect(r.reset).toBe(true);
    expect(getSession(r.session.id)).toBeDefined();
  });
});
