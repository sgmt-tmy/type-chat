import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../errors";
import {
  BadRequestError,
  errorResponse,
  handleApi,
  jsonResponse,
  readJsonBody,
  UnauthenticatedError,
} from "./http";

describe("errorResponse", () => {
  it.each([
    ["validation", 400],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
  ] as const)("DomainError の %s を %i に変換する", async (code, status) => {
    const res = errorResponse(new DomainError(code, "文言"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: "文言" } });
  });

  it("UnauthenticatedError を 401 にする", async () => {
    const res = errorResponse(new UnauthenticatedError());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthenticated", message: "利用を開始してください" },
    });
  });

  it("想定外の例外は 500 で、内容を本文に含めない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("SQLITE_CONSTRAINT: secret"));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal", message: "サーバーでエラーが発生しました" },
    });
    expect(text).not.toContain("SQLITE_CONSTRAINT");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Content-Type が application/json", () => {
    expect(errorResponse(new Error("x")).headers.get("Content-Type")).toContain(
      "application/json",
    );
  });
});

describe("readJsonBody / handleApi", () => {
  it("JSON として読めない本文は 400 になる", async () => {
    const request = new Request("http://localhost/api", { method: "POST", body: "not json" });
    const res = await handleApi(async () => {
      await readJsonBody(request);
      return jsonResponse({});
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "リクエストの形式が正しくありません" },
    });
  });

  it("BadRequestError を 400 にする", async () => {
    const res = await handleApi(async () => {
      throw new BadRequestError();
    });
    expect(res.status).toBe(400);
  });
});

describe("jsonResponse", () => {
  it("Date を ISO 8601 の文字列にする", async () => {
    const res = jsonResponse({ at: new Date("2026-09-28T12:34:56.789Z") });
    expect(await res.json()).toEqual({ at: "2026-09-28T12:34:56.789Z" });
    expect(res.status).toBe(200);
  });
});
