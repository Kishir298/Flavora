import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileForm } from "./ProfileForm";

describe("ProfileForm", () => {
  it("submits parsed allergies/avoid as arrays", async () => {
    const onSave = vi.fn();
    render(
      <ProfileForm
        initial={{ allergies: [], avoidFoods: [], favoriteCuisines: [], spicePreference: "medium", skillLevel: "beginner", nutritionGoals: {}, preferredCookTimeMinutes: 30, theme: "light" }}
        onSave={onSave}
      />
    );
    fireEvent.change(screen.getByLabelText(/Allergies/i), { target: { value: "peanut, milk" } });
    fireEvent.change(screen.getByLabelText(/Foods to avoid/i), { target: { value: "pork" } });
    fireEvent.click(screen.getByRole("button", { name: /Save profile/i }));
    expect(onSave).toHaveBeenCalledOnce();
    const arg = onSave.mock.calls[0][0] as { allergies: string[]; avoidFoods: string[] };
    expect(arg.allergies).toEqual(["peanut", "milk"]);
    expect(arg.avoidFoods).toEqual(["pork"]);
  });
});
