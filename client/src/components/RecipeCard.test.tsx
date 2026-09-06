import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecipeCard } from "./RecipeCard";

describe("RecipeCard", () => {
  it("renders title, meta, and links to detail", () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={{ id: "mock:1", title: "Tomato Pasta", cuisine: "italian", cookTime: 25, ingredients: ["pasta", "tomato"], score: 0.87 }} />
      </MemoryRouter>
    );
    expect(screen.getByText("Tomato Pasta")).toBeInTheDocument();
    expect(screen.getByLabelText("Open Tomato Pasta").getAttribute("href")).toContain("mock%3A1");
  });
});
