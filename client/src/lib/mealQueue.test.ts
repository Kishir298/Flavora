import { describe, it, expect, vi } from "vitest";
import { executeMutation } from "./useOnlineStatus";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    interact: vi.fn(),
    addMeal: vi.fn(),
    updateMeal: vi.fn(),
    removeMeal: vi.fn(),
    mealLog: { add: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
}));

describe("offline meal-log replay", () => {
  it("replays add/update/remove against the meal-log API", async () => {
    await executeMutation({ id: "a", operation: "meallog.add", entityType: "meallog", entityId: "new", payload: { name: "Soup" }, createdAt: 0, attemptCount: 0, status: "pending" });
    expect(api.mealLog.add).toHaveBeenCalledWith({ name: "Soup" });
    await executeMutation({ id: "b", operation: "meallog.update", entityType: "meallog", entityId: "x", payload: { id: "x", name: "Soup+" }, createdAt: 0, attemptCount: 0, status: "pending" });
    expect(api.mealLog.update).toHaveBeenCalledWith("x", { id: "x", name: "Soup+" });
    await executeMutation({ id: "c", operation: "meallog.remove", entityType: "meallog", entityId: "x", payload: { id: "x" }, createdAt: 0, attemptCount: 0, status: "pending" });
    expect(api.mealLog.remove).toHaveBeenCalledWith("x");
  });
});
