import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { GET, POST } = await import("./route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/users", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function list() {
  return (await (await GET()).json()) as { users: { id: string; name: string }[] };
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("GET /api/users", () => {
  it("0人なら空配列", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [] });
  });

  it("登録順に返す", async () => {
    await post({ name: "a" });
    await post({ name: "b" });
    expect((await list()).users.map((u) => u.name)).toEqual(["a", "b"]);
  });
});

describe("POST /api/users", () => {
  it("トリムして登録し、Cookie を設定する", async () => {
    const res = await post({ name: "  たろう  " });
    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user).toEqual({ id: expect.any(String), name: "たろう" });
    expect((await list()).users).toEqual([user]);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie.startsWith(`type_chat_user_id=${user.id}`)).toBe(true);
    for (const attr of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=31536000"]) {
      expect(cookie).toContain(attr);
    }
  });

  it("空白だけは 400 で増えない", async () => {
    const res = await post({ name: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect((await list()).users).toHaveLength(0);
  });

  it("31文字は 400", async () => {
    const res = await post({ name: "あ".repeat(31) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "validation",
      message: "ユーザー名は30文字以内で入力してください",
    });
  });

  it("name のない本文は 400", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "validation",
      message: "リクエストの形式が正しくありません",
    });
  });

  it("JSON でない本文は 400", async () => {
    expect((await post("oops")).status).toBe(400);
  });

  it("同じ名前は 409 で、増えず Set-Cookie もない", async () => {
    await post({ name: "たろう" });
    for (const name of ["たろう", "  たろう  "]) {
      const res = await post({ name });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toEqual({
        code: "conflict",
        message: "その名前はすでに使われています",
      });
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
    expect((await list()).users).toHaveLength(1);
  });

  it("大文字・小文字だけ違う名前は 201", async () => {
    await post({ name: "Taro" });
    expect((await post({ name: "taro" })).status).toBe(201);
  });
});
