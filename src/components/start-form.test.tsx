import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), refresh: vi.fn() };
const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { StartForm } = await import("./start-form");

const users = [
  { id: "u1", name: "たろう" },
  { id: "u2", name: "はなこ" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

async function submit(name: string) {
  await userEvent.type(screen.getByLabelText("名前"), name);
  await userEvent.click(screen.getByRole("button", { name: "はじめる" }));
}

describe("StartForm 新しい名前", () => {
  it("空白だけの間は「はじめる」が無効", async () => {
    render(<StartForm users={[]} />);
    const button = screen.getByRole("button", { name: "はじめる" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("名前"), "  ");
    expect(button).toBeDisabled();
  });

  it("POST /api/users を呼び、成功したらホームへ移動する", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: {} });
    render(<StartForm users={[]} />);
    await submit("たろう");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(apiFetch).toHaveBeenCalledWith("/api/users", {
      method: "POST",
      body: { name: "たろう" },
    });
    expect(toast.success).toHaveBeenCalledWith("利用を開始しました");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("送信中は無効で「開始中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    render(<StartForm users={[]} />);
    await submit("たろう");
    expect(await screen.findByRole("button", { name: "開始中…" })).toBeDisabled();
  });

  it("31文字ならAPIを呼ばず入力欄の直下にエラーを出す", async () => {
    render(<StartForm users={[]} />);
    await submit("あ".repeat(31));
    const message = await screen.findByText("ユーザー名は30文字以内で入力してください");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("名前")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("名前")).toHaveAttribute("aria-describedby", message.id);
  });

  it("409 の message を入力欄の直下に出す", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "conflict", message: "その名前はすでに使われています" },
    });
    render(<StartForm users={[]} />);
    await submit("たろう");
    const message = await screen.findByText("その名前はすでに使われています");
    expect(screen.getByLabelText("名前")).toHaveAttribute("aria-describedby", message.id);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("通信エラーは toast.error で出し、入力欄の直下には出さない", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "network", message: "通信失敗" } });
    render(<StartForm users={[]} />);
    await submit("たろう");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("通信失敗"));
    expect(screen.queryByText("通信失敗")).toBeNull();
    expect(screen.getByLabelText("名前")).not.toHaveAttribute("aria-invalid");
  });
});

describe("StartForm 既存の利用者", () => {
  it("利用者がいれば見出しと名前のボタンが出る", () => {
    render(<StartForm users={users} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "前に使った名前で入り直す" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "たろう" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "はなこ" })).toBeInTheDocument();
  });

  it("利用者が0人なら見出しが出ない", () => {
    render(<StartForm users={[]} />);
    expect(screen.queryByText("前に使った名前で入り直す")).toBeNull();
  });

  it("押すと PUT /api/session を呼び、成功したらホームへ移動する", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: {} });
    render(<StartForm users={users} />);
    await userEvent.click(screen.getByRole("button", { name: "はなこ" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(apiFetch).toHaveBeenCalledWith("/api/session", {
      method: "PUT",
      body: { userId: "u2" },
    });
    expect(toast.success).toHaveBeenCalledWith("利用を再開しました");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("404 なら toast.error を出す", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "利用者が見つかりません" },
    });
    render(<StartForm users={users} />);
    await userEvent.click(screen.getByRole("button", { name: "たろう" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("利用者が見つかりません"));
  });

  it("ボタンに bg-primary が含まれない", () => {
    render(<StartForm users={users} />);
    expect(screen.getByRole("button", { name: "たろう" }).className).not.toContain("bg-primary");
  });
});
