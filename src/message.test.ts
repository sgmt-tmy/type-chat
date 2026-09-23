import { describe, expect, it } from "vitest";
import { createMessage, MESSAGE_MAX_LENGTH } from "./message";

describe("createMessage", () => {
  it("前後の空白を除いてメッセージを作る", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const message = createMessage("g1", "  こんにちは  ", now);
    expect(message).toEqual({ groupId: "g1", text: "こんにちは", sentAt: now });
  });

  it("空のメッセージはエラーにする", () => {
    expect(() => createMessage("g1", "   ")).toThrow();
  });

  it("上限文字数ちょうどのメッセージは成功する", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const text = "あ".repeat(MESSAGE_MAX_LENGTH);
    const message = createMessage("g1", text, now);
    expect(message.text).toBe(text);
  });

  it("上限文字数を超えるメッセージはエラーにする", () => {
    const text = "あ".repeat(MESSAGE_MAX_LENGTH + 1);
    expect(() => createMessage("g1", text)).toThrow();
  });
});