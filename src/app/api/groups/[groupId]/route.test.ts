import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { createGroup } from "@/group";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { GET } = await import("./route");

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
