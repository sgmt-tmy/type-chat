import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
type LiveOptions = {
  handlers: Record<string, (data: unknown) => void>;
  onReconnect?: () => void;
};
let live: LiveOptions;
const useLiveEvents = vi.fn((options: LiveOptions) => {
  live = options;
});

vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/use-live-events", () => ({
  useLiveEvents: (options: LiveOptions) => useLiveEvents(options),
}));

const { GroupSettingsView } = await import("./group-settings-view");

const group = {
  id: "g1",
  name: "雑談",
  ownerId: "me",
  members: [
    { id: "me", name: "わたし" },
    { id: "u2", name: "はなこ" },
  ],
};

const users = [
  { id: "me", name: "わたし" },
  { id: "u2", name: "はなこ" },
  { id: "u3", name: "じろう" },
  { id: "u4", name: "さぶろう" },
];

function renderView(currentUserId = "me", list = users) {
  return render(
    <GroupSettingsView
      groupId="g1"
      currentUserId={currentUserId}
      initialGroup={group}
      users={list}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupSettingsView", () => {
  it("「チャットに戻る」リンクと h1・h2 がある", () => {
    renderView();
    const back = screen.getByRole("link", { name: "チャットに戻る" });
    expect(back.getAttribute("href")).toBe("/groups/g1");
    expect(back.className).not.toContain("bg-primary");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("グループ設定");
    expect(screen.getByRole("heading", { level: 2, name: "グループ名" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "メンバー" })).toBeTruthy();
  });

  it("オーナーには入力欄と保存があり、主操作は保存だけ", () => {
    renderView();
    expect(screen.getByLabelText("グループ名")).toHaveValue("雑談");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    const primary = screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary"));
    expect(primary.map((b) => b.textContent)).toEqual(["保存"]);
  });

  it("オーナー以外には入力欄と保存がなく、説明が出る", () => {
    renderView("u2");
    expect(screen.getByText("雑談")).toBeTruthy();
    expect(screen.getByText("グループ名はオーナーだけが変更できます")).toBeTruthy();
    expect(screen.queryByLabelText("グループ名")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(
      screen.queryAllByRole("button").filter((b) => b.className.includes("bg-primary")),
    ).toEqual([]);
  });

  it("useLiveEvents は1回だけ使われる", () => {
    renderView();
    expect(useLiveEvents).toHaveBeenCalledTimes(1);
  });

  it("この画面の group.updated で取り直し、応答の名前を表示する", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, name: "新名" } } });
    renderView("u2");
    act(() => live.handlers["group.updated"]?.({ group: { id: "g1" } }));
    expect(await screen.findByText("新名")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1");
  });

  it("別のグループの group.updated では取り直さない", () => {
    renderView();
    act(() => live.handlers["group.updated"]?.({ group: { id: "other" } }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("onReconnect で取り直す", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, name: "再接続後" } } });
    renderView("u2");
    act(() => live.onReconnect?.());
    expect(await screen.findByText("再接続後")).toBeTruthy();
  });

  it("古い応答で新しい表示を上書きしない", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiFetch
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ ok: true, data: { group: { ...group, name: "2回目" } } });
    renderView("u2");
    act(() => live.onReconnect?.());
    act(() => live.onReconnect?.());
    await screen.findByText("2回目");
    await act(async () => {
      resolveFirst({ ok: true, data: { group: { ...group, name: "1回目" } } });
    });
    expect(screen.getByText("2回目")).toBeTruthy();
    expect(screen.queryByText("1回目")).toBeNull();
  });

  it("取り直しが失敗すると toast.error を出し、表示中の名前が残る", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "network", message: "通信失敗" } });
    renderView("u2");
    act(() => live.onReconnect?.());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("通信失敗"));
    expect(screen.getByText("雑談")).toBeTruthy();
  });

  it("名前の変更に成功すると表示に反映され、保存が無効に戻る", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, name: "新名" } } });
    renderView();
    const input = screen.getByLabelText("グループ名");
    await userEvent.clear(input);
    await userEvent.type(input, "新名");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("グループ名を変更しました"));
    expect(screen.getByLabelText("グループ名")).toHaveValue("新名");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("メンバーの名前が参加順に出る", () => {
    renderView();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["わたし（あなた）オーナー", "はなこ"]);
  });

  it("委譲に成功すると、オーナー表示と操作が切り替わる", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, ownerId: "u2" } } });
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "はなこさんの操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "オーナーにする" }));
    await userEvent.click(await screen.findByRole("button", { name: "オーナーにする" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const items = screen.getAllByRole("listitem");
    expect(items[1]?.textContent).toContain("オーナー");
    expect(items[0]?.textContent).not.toContain("オーナー");
    expect(screen.queryByLabelText("グループ名")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.getByText("グループ名はオーナーだけが変更できます")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /さんの操作/ })).toBeNull();
  });

  it("自分への委譲を group.updated で受けて取り直すと、編集と操作が出る", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, ownerId: "u2" } } });
    renderView("u2");
    expect(screen.queryByLabelText("グループ名")).toBeNull();
    act(() => live.handlers["group.updated"]?.({ group: { id: "g1" } }));
    expect(await screen.findByLabelText("グループ名")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "わたしさんの操作" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "はなこさんの操作" })).toBeNull();
  });

  it("確認ダイアログを閉じた状態の主操作は保存だけ", () => {
    renderView();
    const primary = screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary"));
    expect(primary.map((b) => b.textContent)).toEqual(["保存"]);
  });

  it("ソースに setInterval と setTimeout が含まれない", () => {
    for (const file of ["group-settings-view.tsx", "rename-group-form.tsx"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toContain("setInterval");
      expect(source).not.toContain("setTimeout");
    }
  });

  describe("メンバーの追加", () => {
    beforeEach(() => {
      Element.prototype.hasPointerCapture = () => false;
      Element.prototype.scrollIntoView = () => {};
      Element.prototype.releasePointerCapture = () => {};
    });

    it("オーナーには追加フォームが出て、選択肢はメンバーでない利用者だけ（登録順）", async () => {
      renderView();
      expect(screen.getByRole("heading", { level: 3, name: "メンバーを追加" })).toBeTruthy();
      await userEvent.click(screen.getByLabelText("追加する利用者"));
      const options = await screen.findAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["じろう", "さぶろう"]);
    });

    it("オーナー以外には追加フォームが出ない", () => {
      renderView("u2");
      expect(screen.queryByRole("heading", { level: 3, name: "メンバーを追加" })).toBeNull();
      expect(screen.queryByLabelText("追加する利用者")).toBeNull();
    });

    it("全員がメンバーなら案内が出る", () => {
      renderView("me", users.slice(0, 2));
      expect(screen.getByText("追加できる利用者がいません")).toBeTruthy();
    });

    it("追加に成功すると一覧の末尾に行が出て、選択肢から消える", async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        data: {
          group: { ...group, members: [...group.members, { id: "u3", name: "じろう" }] },
        },
      });
      renderView();
      await userEvent.click(screen.getByLabelText("追加する利用者"));
      await userEvent.click(await screen.findByRole("option", { name: "じろう" }));
      await userEvent.click(screen.getByRole("button", { name: "追加" }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("じろうさんを追加しました"));
      const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
      expect(rows[rows.length - 1]).toContain("じろう");
      await userEvent.click(screen.getByLabelText("追加する利用者"));
      const options = await screen.findAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["さぶろう"]);
    });

    it("主操作（bg-primary）は追加フォームがあっても保存だけ", () => {
      renderView();
      const primary = screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("bg-primary"));
      expect(primary.map((b) => b.textContent)).toEqual(["保存"]);
    });

    it("委譲に成功するとフォームが消える", async () => {
      apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, ownerId: "u2" } } });
      renderView();
      await userEvent.click(screen.getByRole("button", { name: "はなこさんの操作" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "オーナーにする" }));
      await userEvent.click(await screen.findByRole("button", { name: "オーナーにする" }));
      await waitFor(() =>
        expect(screen.queryByRole("heading", { level: 3, name: "メンバーを追加" })).toBeNull(),
      );
    });

    it("自分への委譲を受け取って取り直すとフォームが出る", async () => {
      apiFetch.mockResolvedValue({ ok: true, data: { group: { ...group, ownerId: "u2" } } });
      renderView("u2");
      expect(screen.queryByRole("heading", { level: 3, name: "メンバーを追加" })).toBeNull();
      act(() => live.handlers["group.updated"]?.({ group: { id: "g1" } }));
      expect(await screen.findByRole("heading", { level: 3, name: "メンバーを追加" })).toBeTruthy();
    });

    it("group.updated で取り直すと加わったメンバーの行が出る", async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        data: { group: { ...group, members: [...group.members, { id: "u4", name: "さぶろう" }] } },
      });
      renderView("u2");
      act(() => live.handlers["group.updated"]?.({ group: { id: "g1" } }));
      expect(await screen.findByText("さぶろう")).toBeTruthy();
      expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1");
    });
  });
});
