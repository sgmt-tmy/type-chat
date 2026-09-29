import { describe, expect, it } from "vitest";
import { DomainError } from "../errors";
import { addMember, createGroup, removeMember, renameGroup, transferOwner } from "../group";
import { createMessage } from "../message";
import { createUser } from "../user";
import { createDb } from "./client";
import { createGroupRepository } from "./group-repository";
import { createMessageRepository } from "./message-repository";
import { createUserRepository } from "./user-repository";

function setup() {
  const db = createDb(":memory:");
  return {
    users: createUserRepository(db),
    groups: createGroupRepository(db),
    messages: createMessageRepository(db),
  };
}

describe("UserRepository", () => {
  it("insert した User を findById で取り出せる", async () => {
    const { users } = setup();
    const u = createUser("alice");
    await users.insert(u);
    expect(await users.findById(u.id)).toEqual(u);
  });

  it("存在しない id では null", async () => {
    const { users } = setup();
    expect(await users.findById("none")).toBeNull();
  });

  it("同じ name でも insert でき、list が insert 順に返す", async () => {
    const { users } = setup();
    const a = createUser("same");
    const b = createUser("same");
    await users.insert(a);
    await users.insert(b);
    expect(await users.list()).toEqual([a, b]);
  });

  it("空のとき list は空配列", async () => {
    const { users } = setup();
    expect(await users.list()).toEqual([]);
  });
});

describe("GroupRepository", () => {
  it("insert した Group を findById で同じ内容で読める", async () => {
    const { groups } = setup();
    const g = addMember(addMember(createGroup("g", "o"), "b"), "c");
    await groups.insert(g);
    expect(await groups.findById(g.id)).toEqual(g);
  });

  it("存在しない id では null", async () => {
    const { groups } = setup();
    expect(await groups.findById("none")).toBeNull();
  });

  it("listByMember は自分のグループだけを insert 順に返す", async () => {
    const { groups } = setup();
    const g1 = addMember(createGroup("g1", "o"), "me");
    const g2 = createGroup("g2", "other");
    const g3 = addMember(createGroup("g3", "o"), "me");
    await groups.insert(g1);
    await groups.insert(g2);
    await groups.insert(g3);
    expect(await groups.listByMember("me")).toEqual([g1, g3]);
    expect(await groups.listByMember("nobody")).toEqual([]);
  });

  it("save で名前・オーナー・メンバーの変更が反映される", async () => {
    const { groups } = setup();
    const g = addMember(addMember(createGroup("g", "o"), "b"), "c");
    await groups.insert(g);

    const renamed = renameGroup(g, "o", "new");
    await groups.save(renamed);
    expect((await groups.findById(g.id))?.name).toBe("new");

    const transferred = transferOwner(renamed, "o", "b");
    await groups.save(transferred);
    expect((await groups.findById(g.id))?.ownerId).toBe("b");

    const added = addMember(transferred, "d");
    await groups.save(added);
    expect((await groups.findById(g.id))?.members).toEqual(["o", "b", "c", "d"]);

    const removed = removeMember(added, "c");
    await groups.save(removed);
    expect(await groups.findById(g.id)).toEqual(removed);
  });

  it("存在しない Group の save は not_found", async () => {
    const { groups } = setup();
    const err = await groups.save(createGroup("g", "o")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("not_found");
    expect((err as DomainError).message).toBe("グループが見つかりません");
  });

  it("delete は true/false を返し、メンバーとメッセージも消える", async () => {
    const { groups, messages } = setup();
    const g = addMember(createGroup("g", "o"), "b");
    await groups.insert(g);
    const m = createMessage(g.id, "o", "hi");
    await messages.insert(m);
    expect(await groups.delete(g.id)).toBe(true);
    expect(await groups.findById(g.id)).toBeNull();
    expect(await messages.listByGroup(g.id)).toEqual([]);
    expect(await messages.findById(m.id)).toBeNull();
    expect(await groups.listByMember("b")).toEqual([]);
    expect(await groups.delete(g.id)).toBe(false);
  });
});

describe("MessageRepository", () => {
  it("insert した Message を findById で読める（ミリ秒まで）", async () => {
    const { groups, messages } = setup();
    const g = createGroup("g", "o");
    await groups.insert(g);
    const m = createMessage(g.id, "o", "hi", new Date(1700000000123));
    await messages.insert(m);
    expect(await messages.findById(m.id)).toEqual(m);
    expect(await messages.findById("none")).toBeNull();
  });

  it("listByGroup は sentAt 昇順で、他グループを含まない", async () => {
    const { groups, messages } = setup();
    const g = createGroup("g", "o");
    const other = createGroup("other", "o");
    await groups.insert(g);
    await groups.insert(other);
    const m3 = createMessage(g.id, "o", "3", new Date(3000));
    const m1 = createMessage(g.id, "o", "1", new Date(1000));
    const m2 = createMessage(g.id, "o", "2", new Date(2000));
    await messages.insert(m3);
    await messages.insert(m1);
    await messages.insert(createMessage(other.id, "o", "x", new Date(1500)));
    await messages.insert(m2);
    expect(await messages.listByGroup(g.id)).toEqual([m1, m2, m3]);
    expect(await messages.listByGroup("none")).toEqual([]);
  });

  it("存在しない groupId への insert は例外", async () => {
    const { messages } = setup();
    await expect(messages.insert(createMessage("none", "o", "hi"))).rejects.toThrow();
  });

  it("delete は true/false を返す", async () => {
    const { groups, messages } = setup();
    const g = createGroup("g", "o");
    await groups.insert(g);
    const m = createMessage(g.id, "o", "hi");
    await messages.insert(m);
    expect(await messages.delete(m.id)).toBe(true);
    expect(await messages.findById(m.id)).toBeNull();
    expect(await messages.delete(m.id)).toBe(false);
  });
});
