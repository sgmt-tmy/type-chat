import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatHeader } from "./chat-header";

describe("ChatHeader", () => {
  it("戻るリンクは / へ、グループ設定リンクは設定画面へ向かう", () => {
    render(<ChatHeader groupId="g1" groupName="雑談" />);
    expect(screen.getByRole("link", { name: "戻る" }).getAttribute("href")).toBe("/");
    const settings = screen.getByRole("link", { name: "グループ設定" });
    expect(settings.getAttribute("href")).toBe("/groups/g1/settings");
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(settings.textContent).toBe("");
  });

  it("名前が「設定」のリンクがない", () => {
    render(<ChatHeader groupId="g1" groupName="雑談" />);
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
  });

  it("h1 がグループ名である", () => {
    render(<ChatHeader groupId="g1" groupName="雑談" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("雑談");
  });

  it("リンクのクラスに bg-primary が含まれない", () => {
    render(<ChatHeader groupId="g1" groupName="雑談" />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).not.toContain("bg-primary");
    }
  });
});
