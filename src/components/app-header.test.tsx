import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const { AppHeader } = await import("./app-header");

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

  it("userName を渡すと banner の中に利用者メニューのボタンがある", () => {
    render(<AppHeader userName="たろう" />);
    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: "たろう" }),
    ).toBeInTheDocument();
  });

  it("userName を渡さないと利用者メニューのボタンがない", () => {
    render(<AppHeader />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
