import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentUserInPage = vi.fn();
const redirect = vi.fn();

vi.mock("../server/session", () => ({
  requireCurrentUserInPage: () => requireCurrentUserInPage(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error("NEXT_REDIRECT");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api-client", () => ({
  apiFetch: () => Promise.resolve({ ok: true, data: { groups: [] } }),
}));
vi.mock("@/components/use-live-events", () => ({ useLiveEvents: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: HomePage } = await import("./page");
const { redirect: redirectMock } = await import("next/navigation");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomePage", () => {
  it("利用者がいなければ /start へリダイレクトする", async () => {
    requireCurrentUserInPage.mockImplementation(() => {
      redirectMock("/start");
    });
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/start");
  });

  it("h1「グループ」が1つと、入力欄と「作成」ボタンがある", async () => {
    requireCurrentUserInPage.mockResolvedValue({ id: "u1", name: "たろう" });
    render(await HomePage());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("グループ");
    expect(screen.getByLabelText("グループ名")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成" })).toBeInTheDocument();
  });

  it("主操作は「作成」だけ（一覧が空の状態）", async () => {
    requireCurrentUserInPage.mockResolvedValue({ id: "u1", name: "たろう" });
    render(await HomePage());
    await screen.findByText("まだグループがありません");
    const primary = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("bg-primary"));
    expect(primary.map((button) => button.textContent)).toEqual(["作成"]);
  });
});
