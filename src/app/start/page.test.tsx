import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";

let db: Db;
const getCurrentUserInPage = vi.fn();
const redirect = vi.fn();

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));
vi.mock("../../server/session", () => ({ getCurrentUserInPage: () => getCurrentUserInPage() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error("NEXT_REDIRECT");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const { default: StartPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  db = createDb(":memory:");
});

describe("StartPage", () => {
  it("利用者がいれば / へリダイレクトする", async () => {
    getCurrentUserInPage.mockResolvedValue({ id: "x", name: "たろう" });
    await expect(StartPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("利用者がいなければ h1 が1つと開始フォームがある", async () => {
    getCurrentUserInPage.mockResolvedValue(null);
    render(await StartPage());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("type-chat をはじめる");
    expect(screen.getByRole("button", { name: "はじめる" })).toBeInTheDocument();
  });
});
