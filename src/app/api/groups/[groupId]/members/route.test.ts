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

const { POST } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function post(groupId: string, userId: string | null, body: unknown) {
  return POST(
    new Request(`http://localhost/api/groups/${groupId}/members`, {
      method: "POST",
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
  const other = await newUser("じろう");
  const outsider = await newUser("さぶろう");
  const base = createGroup("雑談", owner);
  await createGroupRepository(db).insert(base);
  const g = addMember(base, owner, member);
  await createGroupRepository(db).save(g);
  return { owner, member, other, outsider, g };
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("POST /api/groups/[groupId]/members", () => {
  it("オーナーが追加すると 200 と group.updated（追加された利用者にも届く）", async () => {
    const { owner, member, other, g } = await prepare();
    const got: LiveEvent[] = [];
    const off = subscribe(other, (e) => got.push(e));
    const res = await post(g.id, owner, { userId: other });
    off();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      group: {
        id: g.id,
        name: "雑談",
        ownerId: owner,
        members: [
          { id: owner, name: "たろう" },
          { id: member, name: "はなこ" },
          { id: other, name: "じろう" },
        ],
      },
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      type: "group.updated",
      data: { group: { id: g.id, members: [owner, member, other] } },
    });
    expect((await createGroupRepository(db).listByMember(other)).map((x) => x.id)).toEqual([g.id]);
  });

  it("オーナー以外は 403 で変わらない", async () => {
    const { owner, member, other, g } = await prepare();
    const res = await post(g.id, member, { userId: other });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "メンバーの追加はオーナーのみ可能です" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.members).toEqual([owner, member]);
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const { outsider, other, g } = await prepare();
    const a = await post(g.id, outsider, { userId: other });
    const b = await post(crypto.randomUUID(), outsider, { userId: other });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const body = await a.json();
    expect(body).toEqual({ error: { code: "not_found", message: "グループが見つかりません" } });
    expect(await b.json()).toEqual(body);
  });

  it("存在しない利用者は 404 で変わらない", async () => {
    const { owner, member, g } = await prepare();
    const res = await post(g.id, owner, { userId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "利用者が見つかりません" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.members).toEqual([owner, member]);
  });

  it("すでにメンバーなら 200 で数は変わらない", async () => {
    const { owner, member, g } = await prepare();
    const res = await post(g.id, owner, { userId: member });
    expect(res.status).toBe(200);
    expect((await res.json()).group.members).toHaveLength(2);
  });

  it("userId がなければ 400 で発行しない", async () => {
    const { owner, g } = await prepare();
    const got: LiveEvent[] = [];
    const off = subscribe(owner, (e) => got.push(e));
    const res = await post(g.id, owner, {});
    off();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "リクエストの形式が正しくありません" },
    });
    expect(got).toHaveLength(0);
  });

  it("Cookie がなければ 401", async () => {
    const res = await post(crypto.randomUUID(), null, { userId: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
