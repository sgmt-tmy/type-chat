import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { addMember, createGroup } from "@/group";
import { subscribe, type LiveEvent } from "@/server/events";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { PUT } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function put(groupId: string, userId: string | null, body: unknown) {
  return PUT(
    new Request(`http://localhost/api/groups/${groupId}/owner`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(userId ? { cookie: `type_chat_user_id=${userId}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId }) },
  );
}

async function prepare() {
  const owner = await newUser("たろう");
  const member = await newUser("はなこ");
  const outsider = await newUser("じろう");
  const base = createGroup("雑談", owner);
  const g = addMember(base, member);
  await createGroupRepository(db).insert(base);
  await createGroupRepository(db).save(g);
  return { owner, member, outsider, g };
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("PUT /api/groups/[groupId]/owner", () => {
  it("オーナーがメンバーに委譲すると 200 と group.updated", async () => {
    const { owner, member, g } = await prepare();
    const got: LiveEvent[] = [];
    const off = subscribe(member, (e) => got.push(e));
    const res = await put(g.id, owner, { userId: member });
    off();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      group: {
        id: g.id,
        name: "雑談",
        ownerId: member,
        members: [
          { id: owner, name: "たろう" },
          { id: member, name: "はなこ" },
        ],
      },
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "group.updated", data: { group: { ownerId: member } } });
  });

  it("オーナー以外は 403 で変わらない", async () => {
    const { owner, member, g } = await prepare();
    const res = await put(g.id, member, { userId: member });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "オーナー権限の委譲はオーナーのみ可能です" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.ownerId).toBe(owner);
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const { outsider, member, g } = await prepare();
    const a = await put(g.id, outsider, { userId: member });
    const b = await put(crypto.randomUUID(), outsider, { userId: member });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const body = await a.json();
    expect(body).toEqual({ error: { code: "not_found", message: "グループが見つかりません" } });
    expect(await b.json()).toEqual(body);
  });

  it("自分への委譲は 400", async () => {
    const { owner, g } = await prepare();
    const res = await put(g.id, owner, { userId: owner });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "委譲先が現在のオーナーと同じです" },
    });
  });

  it("メンバーでない委譲先は 400", async () => {
    const { owner, outsider, g } = await prepare();
    const res = await put(g.id, owner, { userId: outsider });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "委譲先はグループのメンバーである必要があります" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.ownerId).toBe(owner);
  });

  it("userId がなければ 400 で発行しない", async () => {
    const { owner, g } = await prepare();
    const got: LiveEvent[] = [];
    const off = subscribe(owner, (e) => got.push(e));
    const res = await put(g.id, owner, {});
    off();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "リクエストの形式が正しくありません" },
    });
    expect(got).toHaveLength(0);
  });

  it("Cookie がなければ 401", async () => {
    const res = await put(crypto.randomUUID(), null, { userId: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
