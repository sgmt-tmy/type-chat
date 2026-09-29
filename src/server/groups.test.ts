import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createGroupRepository } from "../db/group-repository";
import { createUserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { addMember, createGroup } from "../group";
import { subscribe, type LiveEvent } from "./events";
import {
  createGroupByUser,
  findGroupAsMember,
  getGroupDetail,
  listGroupsOfUser,
  renameGroupByUser,
  transferOwnerByUser,
  UNKNOWN_MEMBER_NAME,
} from "./groups";

function setup() {
  const db = createDb(":memory:");
  return { groups: createGroupRepository(db), users: createUserRepository(db) };
}

async function addUser(users: ReturnType<typeof setup>["users"], id: string, name: string) {
  await users.insert({ id, name });
}

describe("createGroupByUser", () => {
  it("トリムして作成者をオーナー兼メンバーにして保存する", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    const g = await createGroupByUser(groups, "u1", "  雑談  ");
    expect(g).toMatchObject({ name: "雑談", ownerId: "u1", members: ["u1"] });
    expect(await groups.findById(g.id)).toEqual(g);
  });

  it("空白だけは validation で保存しない", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    await expect(createGroupByUser(groups, "u1", "   ")).rejects.toMatchObject({
      code: "validation",
      message: "グループ名は空にできません",
    });
    expect(await groups.listByMember("u1")).toEqual([]);
  });

  it("51文字は validation で保存しない", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    await expect(createGroupByUser(groups, "u1", "あ".repeat(51))).rejects.toMatchObject({
      code: "validation",
      message: "グループ名は50文字以内で入力してください",
    });
    expect(await groups.listByMember("u1")).toEqual([]);
  });
});

describe("listGroupsOfUser", () => {
  it("自分のグループだけを新しい順に、memberCount つきで返す", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    await addUser(users, "u2", "b");
    const a = await createGroupByUser(groups, "u1", "A");
    const b = await createGroupByUser(groups, "u1", "B");
    await createGroupByUser(groups, "u2", "他人");
    const c = await createGroupByUser(groups, "u1", "C");
    await groups.save({ ...c, members: ["u1", "u2"] });
    const list = await listGroupsOfUser(groups, "u1");
    expect(list.map((g) => g.id)).toEqual([c.id, b.id, a.id]);
    expect(list.map((g) => g.memberCount)).toEqual([2, 1, 1]);
    expect(list[0]).toEqual({ id: c.id, name: "C", ownerId: "u1", memberCount: 2 });
  });

  it("メンバーでなければ空配列", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    await createGroupByUser(groups, "u1", "A");
    expect(await listGroupsOfUser(groups, "u9")).toEqual([]);
  });
});

describe("findGroupAsMember", () => {
  it("メンバーには返す", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    const g = await createGroupByUser(groups, "u1", "A");
    expect(await findGroupAsMember(groups, g.id, "u1")).toEqual(g);
  });

  it("メンバーでない・存在しないは同じ not_found", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    await addUser(users, "u2", "b");
    const g = await createGroupByUser(groups, "u1", "A");
    for (const [id, uid] of [
      [g.id, "u2"],
      [crypto.randomUUID(), "u1"],
    ]) {
      const err = await findGroupAsMember(groups, id, uid).catch((e) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: "not_found", message: "グループが見つかりません" });
    }
  });
});

describe("getGroupDetail", () => {
  it("メンバーを参加順に名前つきで返す", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "たろう");
    await addUser(users, "u2", "はなこ");
    const g = await createGroupByUser(groups, "u1", "A");
    await groups.save({ ...g, members: ["u1", "u2"] });
    expect(await getGroupDetail(groups, users, g.id, "u2")).toEqual({
      id: g.id,
      name: "A",
      ownerId: "u1",
      members: [
        { id: "u1", name: "たろう" },
        { id: "u2", name: "はなこ" },
      ],
    });
  });

  it("利用者が見つからないメンバーは不明な利用者にする", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "たろう");
    const g = await createGroupByUser(groups, "u1", "A");
    await groups.save({ ...g, members: ["u1", "ghost"] });
    const detail = await getGroupDetail(groups, users, g.id, "u1");
    expect(detail.members[1]).toEqual({ id: "ghost", name: UNKNOWN_MEMBER_NAME });
  });

  it("メンバーでなければ not_found", async () => {
    const { groups, users } = setup();
    await addUser(users, "u1", "a");
    const g = createGroup("A", "u1");
    await groups.insert(g);
    await expect(getGroupDetail(groups, users, g.id, "u2")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("renameGroupByUser", () => {
  async function prepare() {
    const { groups, users } = setup();
    await addUser(users, "u1", "たろう");
    await addUser(users, "u2", "はなこ");
    await addUser(users, "u3", "じろう");
    const base = createGroup("雑談", "u1");
    await groups.insert(base);
    const g = addMember(base, "u2");
    await groups.save(g);
    return { groups, users, g };
  }

  it("トリムして保存し、名前つきの詳細を返す", async () => {
    const { groups, users, g } = await prepare();
    const detail = await renameGroupByUser(groups, users, g.id, "u1", "  新しい名前  ");
    expect(detail.name).toBe("新しい名前");
    expect(detail.members).toEqual([
      { id: "u1", name: "たろう" },
      { id: "u2", name: "はなこ" },
    ]);
    expect((await groups.findById(g.id))?.name).toBe("新しい名前");
  });

  it("メンバー全員に group.updated を1回ずつ発行し、非メンバーには発行しない", async () => {
    const { groups, users, g } = await prepare();
    const got: Record<string, LiveEvent[]> = { u1: [], u2: [], u3: [] };
    const offs = Object.keys(got).map((id) => subscribe(id, (e) => got[id]?.push(e)));
    await renameGroupByUser(groups, users, g.id, "u1", "新");
    offs.forEach((off) => off());
    for (const id of ["u1", "u2"]) {
      expect(got[id]).toHaveLength(1);
      expect(got[id]?.[0]).toMatchObject({ type: "group.updated", data: { group: { name: "新" } } });
    }
    expect(got.u3).toHaveLength(0);
  });

  it.each([
    ["u2", "新", "forbidden", "グループ名の変更はオーナーのみ可能です"],
    ["u3", "新", "not_found", "グループが見つかりません"],
    ["u1", "   ", "validation", "グループ名は空にできません"],
    ["u1", "あ".repeat(51), "validation", "グループ名は50文字以内で入力してください"],
  ])("失敗（%#）では保存も発行もしない", async (uid, name, code, message) => {
    const { groups, users, g } = await prepare();
    let count = 0;
    const off = subscribe("u1", () => count++);
    const err = await renameGroupByUser(groups, users, g.id, uid, name).catch((e) => e);
    off();
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code, message });
    expect((await groups.findById(g.id))?.name).toBe("雑談");
    expect(count).toBe(0);
  });
});

describe("transferOwnerByUser", () => {
  async function prepare() {
    const { groups, users } = setup();
    await addUser(users, "u1", "たろう");
    await addUser(users, "u2", "はなこ");
    await addUser(users, "u3", "じろう");
    const base = createGroup("雑談", "u1");
    await groups.insert(base);
    const g = addMember(base, "u2");
    await groups.save(g);
    return { groups, users, g };
  }

  it("委譲して保存し、旧オーナーはメンバーに残る", async () => {
    const { groups, users, g } = await prepare();
    const detail = await transferOwnerByUser(groups, users, g.id, "u1", "u2");
    expect(detail.ownerId).toBe("u2");
    const saved = await groups.findById(g.id);
    expect(saved?.ownerId).toBe("u2");
    expect(saved?.members).toContain("u1");
  });

  it("メンバー全員に group.updated を1回ずつ発行する", async () => {
    const { groups, users, g } = await prepare();
    const got: Record<string, LiveEvent[]> = { u1: [], u2: [], u3: [] };
    const offs = Object.keys(got).map((id) => subscribe(id, (e) => got[id]?.push(e)));
    await transferOwnerByUser(groups, users, g.id, "u1", "u2");
    offs.forEach((off) => off());
    for (const id of ["u1", "u2"]) {
      expect(got[id]).toHaveLength(1);
      expect(got[id]?.[0]).toMatchObject({
        type: "group.updated",
        data: { group: { ownerId: "u2" } },
      });
    }
    expect(got.u3).toHaveLength(0);
  });

  it.each([
    ["u2", "u2", "forbidden", "オーナー権限の委譲はオーナーのみ可能です"],
    ["u3", "u2", "not_found", "グループが見つかりません"],
    ["u1", "u1", "validation", "委譲先が現在のオーナーと同じです"],
    ["u1", "u3", "validation", "委譲先はグループのメンバーである必要があります"],
  ])("失敗（%#）では保存も発行もしない", async (uid, target, code, message) => {
    const { groups, users, g } = await prepare();
    let count = 0;
    const off = subscribe("u1", () => count++);
    const err = await transferOwnerByUser(groups, users, g.id, uid, target).catch((e) => e);
    off();
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code, message });
    expect((await groups.findById(g.id))?.ownerId).toBe("u1");
    expect(count).toBe(0);
  });
});
