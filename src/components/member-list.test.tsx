import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { MemberList } = await import("./member-list");

const members = [
  { id: "me", name: "わたし" },
  { id: "u2", name: "はなこ" },
  { id: "u3", name: "じろう" },
];
const updated = { id: "g1", name: "雑談", ownerId: "u2", members };

const onOwnerTransferred = vi.fn();

function renderList(currentUserId = "me", ownerId = "me") {
  return render(
    <MemberList
      groupId="g1"
      members={members}
      ownerId={ownerId}
      currentUserId={currentUserId}
      onOwnerTransferred={onOwnerTransferred}
    />,
  );
}

async function openConfirm() {
  renderList();
  await userEvent.click(screen.getByRole("button", { name: "はなこさんの操作" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "オーナーにする" }));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemberList", () => {
  it("参加順に li が並び、名前・バッジ・（あなた）が出る", () => {
    renderList();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("わたし（あなた）");
    expect(items[1]).toHaveTextContent("はなこ");
    expect(items[2]).toHaveTextContent("じろう");
    expect(screen.getAllByText("オーナー")).toHaveLength(1);
    expect(within(items[0] as HTMLElement).getByText("オーナー")).toBeTruthy();
    expect(screen.getAllByText(/（あなた）/)).toHaveLength(1);
  });

  it("オーナーには自分以外の各行に操作ボタンがあり、主操作の見た目でない", () => {
    renderList();
    expect(screen.queryByRole("button", { name: "わたしさんの操作" })).toBeNull();
    for (const name of ["はなこ", "じろう"]) {
      const button = screen.getByRole("button", { name: `${name}さんの操作` });
      expect(button.className).not.toContain("bg-primary");
    }
  });

  it("オーナーでない利用者には操作ボタンがない", () => {
    renderList("u2");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("メニューから確認ダイアログが開く", async () => {
    const dialog = await openConfirm();
    expect(within(dialog).getByText("はなこさんをオーナーにしますか？")).toBeTruthy();
    expect(
      within(dialog).getByText("委譲するとあなたはグループ名の変更やメンバーの追加ができなくなります。"),
    ).toBeTruthy();
  });

  it("キャンセルでは API を呼ばずに閉じる", async () => {
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("確定すると PUT を呼び、成功で toast・閉じる・onOwnerTransferred", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: updated } });
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole("button", { name: "オーナーにする" }));
    await waitFor(() => expect(onOwnerTransferred).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/owner", {
      method: "PUT",
      body: { userId: "u2" },
    });
    expect(onOwnerTransferred).toHaveBeenCalledWith(updated);
    expect(toast.success).toHaveBeenCalledWith("オーナーをはなこさんに変更しました");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("送信中は確定ボタンが無効で「変更中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole("button", { name: "オーナーにする" }));
    const pending = await within(dialog).findByRole("button", { name: "変更中…" });
    expect(pending).toBeDisabled();
  });

  it("失敗すると toast.error を出し、ダイアログが開いたまま", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "forbidden", message: "だめ" } });
    const dialog = await openConfirm();
    await userEvent.click(within(dialog).getByRole("button", { name: "オーナーにする" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("だめ"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onOwnerTransferred).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "オーナーにする" })).toBeEnabled();
  });

  it("ソースに setInterval と setTimeout が含まれない", () => {
    const source = readFileSync(path.join(__dirname, "member-list.tsx"), "utf8");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });
});
