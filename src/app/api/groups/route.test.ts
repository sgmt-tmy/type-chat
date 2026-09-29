import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { GET, POST } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function req(method: string, userId: string | null, body?: unknown) {
  return new Request("http://localhost/api/groups", {
    method,
    headers: userId ? { cookie: `type_chat_user_id=${userId}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function count(userId: string) {
  return (await createGroupRepository(db).listByMember(userId)).length;
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("POST /api/groups", () => {
  it("201 で作成者がオーナー兼メンバーのグループを返し、一覧に載る", async () => {
    const u = await newUser("a");
    const res = await POST(req("POST", u, { name: "  雑談  " }));
    expect(res.status).toBe(201);
    const { group } = await res.json();
    expect(group).toEqual({ id: expect.any(String), name: "雑談", ownerId: u, members: [u] });
    const list = await (await GET(req("GET", u))).json();
    expect(list.groups.map((g: { id: string }) => g.id)).toEqual([group.id]);
  });

  it("空白だけ・51文字は 400 で増えない", async () => {
    const u = await newUser("a");
    let res = await POST(req("POST", u, { name: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "グループ名は空にできません" },
    });
    res = await POST(req("POST", u, { name: "あ".repeat(51) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "グループ名は50文字以内で入力してください" },
    });
    expect(await count(u)).toBe(0);
  });

  it("name がなければ 400", async () => {
    const u = await newUser("a");
    const res = await POST(req("POST", u, {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "リクエストの形式が正しくありません" },
    });
  });

  it("Cookie がなければ 401 で増えない", async () => {
    const res = await POST(req("POST", null, { name: "x" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    const u = await newUser("a");
    expect(await count(u)).toBe(0);
  });
});

describe("GET /api/groups", () => {
  it("メンバーでなければ空配列", async () => {
    const u = await newUser("a");
    const res = await GET(req("GET", u));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [] });
  });

  it("自分のグループだけを新しい順に、必要なキーつきで返す", async () => {
    const u1 = await newUser("a");
    const u2 = await newUser("b");
    const ids: string[] = [];
    for (const name of ["A", "B"]) {
      ids.push((await (await POST(req("POST", u1, { name }))).json()).group.id);
    }
    await POST(req("POST", u2, { name: "他人" }));
    const { groups } = await (await GET(req("GET", u1))).json();
    expect(groups.map((g: { id: string }) => g.id)).toEqual([ids[1], ids[0]]);
    expect(groups[0]).toEqual({ id: ids[1], name: "B", ownerId: u1, memberCount: 1 });
  });

  it("Cookie がなければ 401", async () => {
    const res = await GET(req("GET", null));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
