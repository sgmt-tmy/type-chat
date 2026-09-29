import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createUserRepository } from "@/db/user-repository";
import { createUser } from "@/user";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { PUT, DELETE } = await import("./route");

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/session", { method: "PUT", body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("PUT /api/session", () => {
  it("既存の利用者に切り替え、Cookie を設定する", async () => {
    const u = createUser("たろう");
    await createUserRepository(db).insert(u);
    const res = await put({ userId: u.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: u.id, name: "たろう" } });
    expect((res.headers.get("Set-Cookie") ?? "").startsWith(`type_chat_user_id=${u.id}`)).toBe(
      true,
    );
  });

  it("存在しない利用者は 404 で Set-Cookie なし", async () => {
    const res = await put({ userId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({
      code: "not_found",
      message: "利用者が見つかりません",
    });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("userId のない本文は 400", async () => {
    const res = await put({});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });
});

describe("DELETE /api/session", () => {
  it("204 で Cookie を削除する（Cookie がなくても）", async () => {
    const res = await DELETE();
    expect(res.status).toBe(204);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie.startsWith("type_chat_user_id=")).toBe(true);
    expect(cookie).toContain("Max-Age=0");
  });
});
