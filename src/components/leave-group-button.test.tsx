import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn() };
const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { LeaveGroupButton } = await import("./leave-group-button");

beforeEach(() => {
  vi.clearAllMocks();
});

async function openDialog() {
  render(<LeaveGroupButton groupId="g1" groupName="雑談" />);
  await userEvent.click(screen.getByRole("button", { name: "グループから脱退" }));
  return screen.findByRole("alertdialog");
}

describe("LeaveGroupButton", () => {
  it("破壊的操作の見た目で、主操作ではない", () => {
    render(<LeaveGroupButton groupId="g1" groupName="雑談" />);
    const button = screen.getByRole("button", { name: "グループから脱退" });
    expect(button.className).toContain("bg-destructive");
    expect(button.className).not.toContain("bg-primary");
  });

  it("押すと確認ダイアログが出て、確定ボタンも破壊的操作の見た目", async () => {
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("「雑談」から脱退しますか？");
    expect(dialog).toHaveTextContent(
      "脱退すると、このグループのメッセージを読んだり送ったりできなくなります。もう一度参加するには、オーナーに追加してもらう必要があります。",
    );
    expect(screen.getByRole("button", { name: "脱退する" }).className).toContain("bg-destructive");
  });

  it("キャンセルではAPIを呼ばずに閉じる", async () => {
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("確定すると DELETE を呼び、成功したらトーストとホームへの移動", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: null });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "脱退する" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/members/me", { method: "DELETE" });
    expect(toast.success).toHaveBeenCalledWith("「雑談」から脱退しました");
  });

  it("送信中は確定ボタンが無効で「脱退中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "脱退する" }));
    expect(await screen.findByRole("button", { name: "脱退中…" })).toBeDisabled();
  });

  it("失敗したらトーストを出し、ダイアログは開いたままで移動しない", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "forbidden", message: "だめです" } });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "脱退する" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("だめです"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "脱退する" })).toBeEnabled();
  });

  it("ソースに setInterval と setTimeout を含まない", () => {
    const source = readFileSync(path.join(__dirname, "leave-group-button.tsx"), "utf8");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });
});
