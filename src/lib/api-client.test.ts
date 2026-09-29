import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-client";

function stubFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("200 と JSON で { ok: true, data } を返す", async () => {
    stubFetch(Response.json({ users: [] }));
    expect(await apiFetch("/api/users")).toEqual({ ok: true, data: { users: [] } });
  });

  it("204 で { ok: true, data: null } を返す", async () => {
    stubFetch(new Response(null, { status: 204 }));
    expect(await apiFetch("/api/session", { method: "DELETE" })).toEqual({
      ok: true,
      data: null,
    });
  });

  it("body を JSON と Content-Type 付きで渡す", async () => {
    const fn = stubFetch(Response.json({}, { status: 201 }));
    await apiFetch("/api/users", { method: "POST", body: { name: "a" } });
    expect(fn).toHaveBeenCalledWith("/api/users", {
      method: "POST",
      body: JSON.stringify({ name: "a" }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("method を省略すると GET", async () => {
    const fn = stubFetch(Response.json({}));
    await apiFetch("/api/users");
    expect(fn).toHaveBeenCalledWith("/api/users", { method: "GET" });
  });

  it("エラー応答の error をそのまま返す", async () => {
    const error = { code: "conflict", message: "その名前はすでに使われています" };
    stubFetch(Response.json({ error }, { status: 409 }));
    expect(await apiFetch("/api/users")).toEqual({ ok: false, error });
  });

  it("JSON でないエラー本文は internal", async () => {
    stubFetch(new Response("oops", { status: 500 }));
    expect(await apiFetch("/api/users")).toEqual({
      ok: false,
      error: { code: "internal", message: "サーバーでエラーが発生しました" },
    });
  });

  it("通信エラーは例外を投げず network を返す", async () => {
    stubFetch(new TypeError("failed"));
    expect(await apiFetch("/api/users")).toEqual({
      ok: false,
      error: {
        code: "network",
        message: "通信に失敗しました。接続を確認してもう一度お試しください",
      },
    });
  });
});
