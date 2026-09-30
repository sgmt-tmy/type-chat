import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("sonner", () => ({ toast }));

const { MessageList } = await import("./message-list");

const messages = [
  {
    id: "m1",
    groupId: "g1",
    senderId: "me",
    senderName: "わたし",
    text: "mine",
    sentAt: new Date(2026, 8, 28, 9, 5).toISOString(),
  },
  {
    id: "m2",
    groupId: "g1",
    senderId: "u2",
    senderName: "はなこ",
    text: "theirs",
    sentAt: new Date(2026, 8, 28, 9, 6).toISOString(),
  },
];

function renderList(onDeleted = vi.fn()) {
  render(
    <MessageList
      state="loaded"
      messages={messages}
      currentUserId="me"
      groupId="g1"
      onRetry={vi.fn()}
      onStartWriting={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  return onDeleted;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "メッセージの操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "削除" }));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("MessageList の削除", () => {
  it("自分のメッセージにだけ操作ボタンが出る", () => {
    renderList();
    expect(
      screen.getAllByRole("button", { name: "メッセージの操作" }),
    ).toHaveLength(1);
  });

  it("削除を選ぶと確認ダイアログが出て、確定ボタンは destructive", async () => {
    renderList();
    const dialog = await openDialog(userEvent.setup());
    expect(dialog.textContent).toContain("このメッセージを削除しますか？");
    expect(dialog.textContent).toContain("削除すると元に戻せません。");
    expect(
      screen.getByRole("button", { name: "削除する" }).className,
    ).toContain("bg-destructive");
  });

  it("キャンセルでは API を呼ばずに閉じる", async () => {
    const user = userEvent.setup();
    renderList();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("送信中は確定ボタンが無効で「削除中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderList();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "削除する" }));
    const button = await screen.findByRole("button", { name: "削除中…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("成功すると DELETE を呼び、トーストを出し、onDeleted を1回呼ぶ", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    const onDeleted = renderList();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/messages/m1", {
      method: "DELETE",
    });
    expect(onDeleted).toHaveBeenCalledWith("m1");
    expect(toast.success).toHaveBeenCalledWith("メッセージを削除しました");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("失敗すると toast.error を出し、ダイアログは開いたままで onDeleted を呼ばない", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", message: "だめ" },
    });
    const user = userEvent.setup();
    const onDeleted = renderList();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("だめ"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("ソースに setInterval と setTimeout がない", () => {
    const source = readFileSync(
      path.join(__dirname, "message-list.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/setInterval|setTimeout/);
  });
});
