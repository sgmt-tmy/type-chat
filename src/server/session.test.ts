import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client";
import { createUserRepository } from "../db/user-repository";
import { createUser } from "../user";
import { handleApi } from "./http";

let db: Db;
const cookieStore = { get: vi.fn() };
const redirectMock = vi.fn();

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  getDb: () => db,
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const {
  buildClearUserCookie,
  buildUserCookie,
  getCurrentUser,
  getCurrentUserInPage,
  requireCurrentUser,
  requireCurrentUserInPage,
} = await import("./session");

function requestWithCookie(value?: string) {
  return new Request("http://localhost/", {
    headers: value === undefined ? {} : { cookie: `type_chat_user_id=${value}` },
  });
}

beforeEach(() => {
  db = createDb(":memory:");
  cookieStore.get.mockReset();
  redirectMock.mockReset();
});

describe("Cookie の組み立て", () => {
  it("設定の値は利用者IDそのままで、属性を含む", () => {
    const value = buildUserCookie("abc");
    expect(value.startsWith("type_chat_user_id=abc")).toBe(true);
    for (const attr of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=31536000"]) {
      expect(value).toContain(attr);
    }
    expect(value).not.toContain("Secure");
  });

  it("削除の値は空で Max-Age=0", () => {
    const value = buildClearUserCookie();
    expect(value.startsWith("type_chat_user_id=")).toBe(true);
    expect(value).toContain("Max-Age=0");
    expect(value).toContain("Path=/");
  });
});

describe("getCurrentUser / requireCurrentUser", () => {
  it("Cookie がなければ null", async () => {
    const users = createUserRepository(db);
    expect(await getCurrentUser(requestWithCookie(), users)).toBeNull();
  });

  it("登録済みの利用者を返す", async () => {
    const users = createUserRepository(db);
    const u = createUser("たろう");
    await users.insert(u);
    expect(await getCurrentUser(requestWithCookie(u.id), users)).toEqual(u);
  });

  it("存在しない UUID は null", async () => {
    const users = createUserRepository(db);
    expect(await getCurrentUser(requestWithCookie(crypto.randomUUID()), users)).toBeNull();
  });

  it("UUID の形でない値は null", async () => {
    const users = createUserRepository(db);
    expect(await getCurrentUser(requestWithCookie("not-a-uuid"), users)).toBeNull();
  });

  it("他の Cookie と並んでいても読める", async () => {
    const users = createUserRepository(db);
    const u = createUser("たろう");
    await users.insert(u);
    const request = new Request("http://localhost/", {
      headers: { cookie: `a=b; type_chat_user_id=${u.id}; c=d` },
    });
    expect(await getCurrentUser(request, users)).toEqual(u);
  });

  it("Cookie がないと requireCurrentUser は handleApi で 401 になる", async () => {
    const users = createUserRepository(db);
    const res = await handleApi(async () => {
      await requireCurrentUser(requestWithCookie(), users);
      return new Response(null);
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});

describe("getCurrentUserInPage / requireCurrentUserInPage", () => {
  it("Cookie がなければ null", async () => {
    cookieStore.get.mockReturnValue(undefined);
    expect(await getCurrentUserInPage()).toBeNull();
  });

  it("登録済みの利用者を返す", async () => {
    const u = createUser("たろう");
    await createUserRepository(db).insert(u);
    cookieStore.get.mockReturnValue({ name: "type_chat_user_id", value: u.id });
    expect(await getCurrentUserInPage()).toEqual(u);
  });

  it("Cookie がなければ /start へリダイレクトする", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await requireCurrentUserInPage();
    expect(redirectMock).toHaveBeenCalledWith("/start");
  });
});
