import { describe, expect, it } from "vitest";
import { createGroup } from "./group";
import {
  createMessage,
  MESSAGE_MAX_LENGTH,
  postMessageToGroup,
  sortMessagesByTime,
} from "./message";

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

describe("postMessageToGroup", () => {
  it("メンバーが投稿すると、groupIdが正しく設定されたMessageが返る", () => {
    const owner = createGroup("group1", "owner");
    const group = { ...owner, members: [...owner.members, "member1"] };
    const now = new Date("2026-01-01T00:00:00Z");

    const message = postMessageToGroup(group, "member1", "こんにちは", now);

    expect(message).toEqual({ groupId: group.name, text: "こんにちは", sentAt: now });
  });

  it("オーナーは投稿できる", () => {
    const group = createGroup("group1", "owner");

    const message = postMessageToGroup(group, "owner", "こんにちは");

    expect(message.groupId).toBe(group.name);
  });

  it("メンバーでないユーザーが投稿しようとすると例外が投げられる", () => {
    const group = createGroup("group1", "owner");

    expect(() => postMessageToGroup(group, "stranger", "こんにちは")).toThrow();
  });

  it("空文字を投稿しようとすると例外が投げられる", () => {
    const group = createGroup("group1", "owner");

    expect(() => postMessageToGroup(group, "owner", "   ")).toThrow();
  });

  it("上限文字数を超える本文を投稿しようとすると例外が投げられる", () => {
    const group = createGroup("group1", "owner");
    const text = "あ".repeat(MESSAGE_MAX_LENGTH + 1);

    expect(() => postMessageToGroup(group, "owner", text)).toThrow();
  });

  it("sentAtを省略した場合、現在時刻が設定される", () => {
    const group = createGroup("group1", "owner");
    const before = new Date();

    const message = postMessageToGroup(group, "owner", "こんにちは");

    const after = new Date();
    expect(message.sentAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(message.sentAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("sortMessagesByTime", () => {
  it("順不同のメッセージをsentAt昇順に並び替える", () => {
    const m1 = createMessage("g1", "1番目", new Date("2026-01-01T00:00:00Z"));
    const m2 = createMessage("g1", "2番目", new Date("2026-01-02T00:00:00Z"));
    const m3 = createMessage("g1", "3番目", new Date("2026-01-03T00:00:00Z"));

    const sorted = sortMessagesByTime([m3, m1, m2]);

    expect(sorted.map((m) => m.text)).toEqual(["1番目", "2番目", "3番目"]);
  });

  it("元の配列を変更しない", () => {
    const m1 = createMessage("g1", "1番目", new Date("2026-01-01T00:00:00Z"));
    const m2 = createMessage("g1", "2番目", new Date("2026-01-02T00:00:00Z"));
    const original = [m2, m1];

    sortMessagesByTime(original);

    expect(original.map((m) => m.text)).toEqual(["2番目", "1番目"]);
  });
});