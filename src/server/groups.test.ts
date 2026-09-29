import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createGroupRepository } from "../db/group-repository";
import { createUserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { createGroup } from "../group";
import {
  createGroupByUser,
  findGroupAsMember,
  getGroupDetail,
  listGroupsOfUser,
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
