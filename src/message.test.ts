import { describe, expect, it } from "vitest";
import { createMessage } from "./message";

describe("createMessage", () => {
  it("前後の空白を除いてメッセージを作る", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const message = createMessage("g1", "  こんにちは  ", now);
    expect(message).toEqual({ groupId: "g1", text: "こんにちは", sentAt: now });
  });

  it("空のメッセージはエラーにする", () => {
    expect(() => createMessage("g1", "   ")).toThrow();
  });
});