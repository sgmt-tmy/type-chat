import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createGroupRepository } from "../db/group-repository";
import { createMessageRepository } from "../db/message-repository";
import { createUserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { createGroup } from "../group";
import { subscribe, type LiveEvent } from "./events";
import { deleteMessageByUser, listMessagesOfGroup, postMessageByUser } from "./messages";

async function setup() {
  const db = createDb(":memory:");
  const groups = createGroupRepository(db);
  const messages = createMessageRepository(db);
  const users = createUserRepository(db);
  await users.insert({ id: "u1", name: "たろう" });
  await users.insert({ id: "u2", name: "はなこ" });
  await users.insert({ id: "u3", name: "外部" });
  const g = createGroup("雑談", "u1");
  g.members.push("u2");
  await groups.insert(g);
  return { groups, messages, users, g };
}

describe("listMessagesOfGroup", () => {
  it("sentAt 昇順で全件を、投稿者名つきで返す", async () => {
    const { groups, messages, users, g } = await setup();
    await messages.insert({ id: "m2", groupId: g.id, senderId: "u2", text: "b", sentAt: new Date(2000) });
    await messages.insert({ id: "m1", groupId: g.id, senderId: "u1", text: "a", sentAt: new Date(1000) });
    const list = await listMessagesOfGroup(groups, messages, users, g.id, "u1");
    expect(list.map((m) => [m.id, m.senderName])).toEqual([
      ["m1", "たろう"],
      ["m2", "はなこ"],
    ]);
  });

  it("外れたメンバーの名前も出て、利用者がなければ不明な利用者", async () => {
    const { groups, messages, users, g } = await setup();
    await messages.insert({ id: "m1", groupId: g.id, senderId: "u3", text: "a", sentAt: new Date(1000) });
    await messages.insert({ id: "m2", groupId: g.id, senderId: "ghost", text: "b", sentAt: new Date(2000) });
    const list = await listMessagesOfGroup(groups, messages, users, g.id, "u1");
    expect(list.map((m) => m.senderName)).toEqual(["外部", "不明な利用者"]);
  });

  it("0件なら空配列", async () => {
    const { groups, messages, users, g } = await setup();
    expect(await listMessagesOfGroup(groups, messages, users, g.id, "u1")).toEqual([]);
  });

  it("メンバーでない・存在しないグループは not_found", async () => {
    const { groups, messages, users, g } = await setup();
    for (const [gid, uid] of [
      [g.id, "u3"],
      ["nope", "u1"],
    ]) {
      const err = await listMessagesOfGroup(groups, messages, users, gid, uid).catch((e) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: "not_found", message: "グループが見つかりません" });
    }
  });
});

describe("postMessageByUser", () => {
  it("トリムして保存し、名前つきで返す", async () => {
    const { groups, messages, users, g } = await setup();
    const m = await postMessageByUser(groups, messages, users, g.id, "u1", "  こんにちは  ");
    expect(m).toMatchObject({ text: "こんにちは", groupId: g.id, senderId: "u1", senderName: "たろう" });
    expect((await messages.listByGroup(g.id)).map((x) => x.id)).toEqual([m.id]);
  });

  it("メンバー全員に message.created を1回ずつ発行し、非メンバーには発行しない", async () => {
    const { groups, messages, users, g } = await setup();
    const got: Record<string, LiveEvent[]> = { u1: [], u2: [], u3: [] };
    const offs = Object.keys(got).map((id) => subscribe(id, (e) => got[id].push(e)));
    const m = await postMessageByUser(groups, messages, users, g.id, "u1", "hi");
    offs.forEach((off) => off());
    for (const id of ["u1", "u2"]) {
      expect(got[id]).toHaveLength(1);
      expect(got[id][0]).toMatchObject({
        type: "message.created",
        data: { groupId: g.id, message: { id: m.id } },
      });
    }
    expect(got.u3).toHaveLength(0);
  });

  it.each([
    ["   ", "validation", "メッセージは空にできません", "u1"],
    ["a".repeat(1001), "validation", "メッセージは1000文字以内にしてください", "u1"],
    ["hi", "not_found", "グループが見つかりません", "u3"],
  ])("失敗（%#）では保存も発行もしない", async (text, code, message, uid) => {
    const { groups, messages, users, g } = await setup();
    let count = 0;
    const off = subscribe("u1", () => count++);
    const err = await postMessageByUser(groups, messages, users, g.id, uid, text).catch((e) => e);
    off();
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code, message });
    expect(await messages.listByGroup(g.id)).toEqual([]);
    expect(count).toBe(0);
  });
});

describe("deleteMessageByUser", () => {
  async function withMessage() {
    const s = await setup();
    const m = await postMessageByUser(
      s.groups,
      s.messages,
      s.users,
      s.g.id,
      "u1",
      "hi",
    );
    return { ...s, m };
  }

  it("投稿者が削除でき、メンバー全員に message.deleted が1回ずつ届く", async () => {
    const { groups, messages, g, m } = await withMessage();
    const got: Record<string, LiveEvent[]> = { u1: [], u2: [], u3: [] };
    const offs = Object.keys(got).map((id) =>
      subscribe(id, (e) => got[id].push(e)),
    );
    await deleteMessageByUser(groups, messages, g.id, "u1", m.id);
    offs.forEach((off) => off());
    expect(await messages.findById(m.id)).toBeNull();
    for (const id of ["u1", "u2"]) {
      expect(got[id]).toHaveLength(1);
      expect(got[id][0]).toMatchObject({
        type: "message.deleted",
        data: { groupId: g.id, messageId: m.id },
      });
    }
    expect(got.u3).toHaveLength(0);
  });

  it.each([
    [
      "投稿者でないメンバー",
      "u2",
      "m",
      "forbidden",
      "メッセージを削除できるのは投稿者のみです",
    ],
    [
      "メンバーでない利用者",
      "u3",
      "m",
      "not_found",
      "グループが見つかりません",
    ],
    [
      "存在しないメッセージ",
      "u1",
      "none",
      "not_found",
      "メッセージが見つかりません",
    ],
  ])(
    "%s は失敗し、削除も発行もしない",
    async (_name, uid, target, code, message) => {
      const { groups, messages, g, m } = await withMessage();
      let count = 0;
      const off = subscribe("u1", () => count++);
      const err = await deleteMessageByUser(
        groups,
        messages,
        g.id,
        uid,
        target === "m" ? m.id : crypto.randomUUID(),
      ).catch((e) => e);
      off();
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code, message });
      expect(await messages.findById(m.id)).not.toBeNull();
      expect(count).toBe(0);
    },
  );

  it("別のグループのメッセージIDは not_found で、メッセージが残る", async () => {
    const { groups, messages, m } = await withMessage();
    const other = createGroup("別", "u1");
    await groups.insert(other);
    const err = await deleteMessageByUser(
      groups,
      messages,
      other.id,
      "u1",
      m.id,
    ).catch((e) => e);
    expect(err).toMatchObject({
      code: "not_found",
      message: "メッセージが見つかりません",
    });
    expect(await messages.findById(m.id)).not.toBeNull();
  });
});
