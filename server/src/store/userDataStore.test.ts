import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserDataStore, ValidationError, STORE_VERSION } from "./userDataStore.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flavora-store-"));
  file = path.join(dir, "user-data.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const meal = (over: Record<string, unknown> = {}) => ({
  name: "Oatmeal",
  mealType: "breakfast",
  loggedAt: "2026-09-10T08:00:00.000Z",
  foods: [{ name: "oats", quantity: 50, unit: "g" }],
  nutrition: { calories: 300, protein_g: 10 },
  tags: ["vegetarian"],
  ...over,
});

describe("userDataStore — local JSON persistence", () => {
  it("initializes with versioned empty schema", () => {
    const s = new UserDataStore(file);
    const d = s.init();
    expect(d.version).toBe(STORE_VERSION);
    expect(d.meals).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("create → read → update → delete meal", () => {
    const s = new UserDataStore(file);
    const created = s.addMeal(meal());
    expect(created.id).toBeTruthy();
    expect(s.listMeals()).toHaveLength(1);
    const updated = s.updateMeal(created.id, { name: "Oatmeal+" });
    expect(updated?.name).toBe("Oatmeal+");
    expect(s.removeMeal(created.id)).toBe(true);
    expect(s.listMeals()).toHaveLength(0);
    expect(s.updateMeal("nope", { name: "x" })).toBeNull();
    expect(s.removeMeal("nope")).toBe(false);
  });

  it("data survives store re-initialization (restart)", () => {
    const s = new UserDataStore(file);
    s.addMeal(meal());
    s.saveGoals({ mealsPerDay: 3 });
    const s2 = new UserDataStore(file);
    expect(s2.listMeals()).toHaveLength(1);
    expect(s2.getGoals().mealsPerDay).toBe(3);
  });

  it("validates meal input", () => {
    const s = new UserDataStore(file);
    expect(() => s.addMeal({})).toThrow(ValidationError);
    expect(() => s.addMeal(meal({ mealType: "brunch" }))).toThrow(ValidationError);    expect(() => s.addMeal(meal({ loggedAt: "not-a-date" }))).toThrow(ValidationError);
    expect(() => s.addMeal(meal({ foods: [{ name: "" }] }))).toThrow(ValidationError);
  });

  it("validates goals ranges", () => {
    const s = new UserDataStore(file);
    expect(() => s.saveGoals({ maxCalories: -5 })).toThrow(ValidationError);
    const g = s.saveGoals({ maxCalories: 2000, waterMlPerDay: 1500 });
    expect(g.maxCalories).toBe(2000);
    expect(s.getGoals().waterMlPerDay).toBe(1500);
  });

  it("recovers from a corrupt file with backup, never throws", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    const s = new UserDataStore(file);
    const d = s.init();
    expect(d.meals).toEqual([]);
    const bak = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(bak.length).toBe(1);
  });

  it("accepts the Other meal type and backfilled timestamps", () => {
    const s = new UserDataStore(file);
    const rec = s.addMeal(meal({ mealType: "other", loggedAt: "2026-01-05T10:00:00.000Z" }));
    expect(rec.mealType).toBe("other");
    expect(rec.loggedAt).toBe("2026-01-05T10:00:00.000Z");
  });

  it("water logging validates", () => {
    const s = new UserDataStore(file);
    const w = s.addWater(250);
    expect(w.ml).toBe(250);
    expect(() => s.addWater(-1)).toThrow(ValidationError);
  });
});
