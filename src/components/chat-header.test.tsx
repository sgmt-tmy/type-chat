import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatHeader } from "./chat-header";

describe("ChatHeader", () => {
  it("戻るリンクは / へ、設定リンクは設定画面へ向かう", () => {
    render(<ChatHeader groupId="g1" groupName="雑談" />);
    expect(screen.getByRole("link", { name: "戻る" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "設定" }).getAttribute("href")).toBe(
      "/groups/g1/settings",
    );
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
