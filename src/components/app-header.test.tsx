import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("banner の中に、type-chat という名前で / へのリンクがある", () => {
    render(<AppHeader />);
    const link = within(screen.getByRole("banner")).getByRole("link", {
      name: "type-chat",
    });
    expect(link).toHaveAttribute("href", "/");
  });

  it("h1 がない", () => {
    render(<AppHeader />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
