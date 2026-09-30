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

const { GET, PATCH } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function call(groupId: string, userId: string | null) {
  return GET(
    new Request(`http://localhost/api/groups/${groupId}`, {
      headers: userId ? { cookie: `type_chat_user_id=${userId}` } : {},
    }),
    { params: Promise.resolve({ groupId }) },
  );
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("GET /api/groups/[groupId]", () => {
  it("メンバーには名前つきの詳細を返す", async () => {
    const u = await newUser("たろう");
    const g = createGroup("雑談", u);
    await createGroupRepository(db).insert(g);
    const res = await call(g.id, u);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      group: { id: g.id, name: "雑談", ownerId: u, members: [{ id: u, name: "たろう" }] },
    });
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const u = await newUser("a");
    const other = await newUser("b");
    const g = createGroup("雑談", u);
    await createGroupRepository(db).insert(g);
    const notMember = await call(g.id, other);
    const missing = await call(crypto.randomUUID(), other);
    expect(notMember.status).toBe(404);
    expect(missing.status).toBe(404);
    const body = await notMember.json();
    expect(body).toEqual({ error: { code: "not_found", message: "グループが見つかりません" } });
    expect(await missing.json()).toEqual(body);
  });

  it("Cookie がなければ 401", async () => {
    const res = await call(crypto.randomUUID(), null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});

function patch(groupId: string, userId: string | null, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/groups/${groupId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(userId ? { cookie: `type_chat_user_id=${userId}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId }) },
  );
}

describe("PATCH /api/groups/[groupId]", () => {
  async function prepare() {
    const owner = await newUser("たろう");
    const member = await newUser("はなこ");
    const outsider = await newUser("じろう");
    const base = createGroup("雑談", owner);
    await createGroupRepository(db).insert(base);
    const g = addMember(base, owner, member);
    await createGroupRepository(db).save(g);
    return { owner, member, outsider, g };
  }

  it("オーナーは名前を変えられ、GET に反映され、group.updated が発行される", async () => {
    const { owner, member, g } = await prepare();
    const events: LiveEvent[] = [];
    const off = subscribe(member, (e) => events.push(e));
    const res = await patch(g.id, owner, { name: "  新しい名前  " });
    off();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      group: {
        id: g.id,
        name: "新しい名前",
        ownerId: owner,
        members: [
          { id: owner, name: "たろう" },
          { id: member, name: "はなこ" },
        ],
      },
    });
    expect((await (await call(g.id, owner)).json()).group.name).toBe("新しい名前");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "group.updated", data: { group: { id: g.id } } });
  });

  it("オーナー以外のメンバーは 403", async () => {
    const { member, g } = await prepare();
    const res = await patch(g.id, member, { name: "新" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "グループ名の変更はオーナーのみ可能です" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.name).toBe("雑談");
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const { outsider, g } = await prepare();
    const a = await patch(g.id, outsider, { name: "新" });
    const b = await patch(crypto.randomUUID(), outsider, { name: "新" });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual({
      error: { code: "not_found", message: "グループが見つかりません" },
    });
    expect((await createGroupRepository(db).findById(g.id))?.name).toBe("雑談");
  });

  it.each([
    [{ name: "   " }, "グループ名は空にできません"],
    [{ name: "あ".repeat(51) }, "グループ名は50文字以内で入力してください"],
    [{}, "リクエストの形式が正しくありません"],
    [{ name: 1 }, "リクエストの形式が正しくありません"],
  ])("不正な本文（%#）は 400", async (body, message) => {
    const { owner, g } = await prepare();
    let count = 0;
    const off = subscribe(owner, () => count++);
    const res = await patch(g.id, owner, body);
    off();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "validation", message } });
    expect(count).toBe(0);
  });

  it("Cookie がなければ 401", async () => {
    const res = await patch(crypto.randomUUID(), null, { name: "新" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
