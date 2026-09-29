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

const { ChatView } = await import("./chat-view");

const members = [
  { id: "me", name: "わたし" },
  { id: "u2", name: "はなこ" },
];

function m(id: string, senderId: string, name: string, minute: number, groupId = "g1") {
  return {
    id,
    groupId,
    senderId,
    senderName: name,
    text: `text-${id}`,
    sentAt: new Date(2026, 8, 28, 9, minute).toISOString(),
  };
}

function ok(messages: unknown[]) {
  return { ok: true, data: { messages } };
}

function renderView() {
  return render(<ChatView groupId="g1" groupName="雑談" currentUserId="me" members={members} />);
}

function created(message: ReturnType<typeof m>, groupId = message.groupId) {
  act(() => {
    live.handlers["message.created"]?.({ groupId, message });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("ChatView", () => {
  it("マウントで GET を1回呼び、useLiveEvents を使い、取得中は Skeleton を出す", () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = renderView();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/messages");
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("雑談");
  });

  it("取得に成功すると一覧を描画する", async () => {
    apiFetch.mockResolvedValue(ok([m("1", "u2", "はなこ", 1)]));
    renderView();
    expect(await screen.findByText("text-1")).toBeTruthy();
    expect(screen.getByText("はなこ")).toBeTruthy();
  });

  it("取得に失敗すると toast と失敗表示を出し、再読み込みで取り直せる", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, error: { code: "internal", message: "失敗" } });
    renderView();
    expect(await screen.findByText("メッセージを読み込めませんでした")).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("失敗");
    apiFetch.mockResolvedValueOnce(ok([m("1", "u2", "はなこ", 1)]));
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("text-1")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("message.created を末尾に足す。別グループ・重複は無視する", async () => {
    apiFetch.mockResolvedValue(ok([m("1", "u2", "はなこ", 1)]));
    renderView();
    await screen.findByText("text-1");
    created(m("2", "u2", "", 2));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("はなこ")).toHaveLength(2);
    created(m("2", "u2", "", 2));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    created(m("9", "u2", "", 3, "g2"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("古い sentAt は昇順の位置に入る", async () => {
    apiFetch.mockResolvedValue(ok([m("1", "u2", "はなこ", 5)]));
    renderView();
    await screen.findByText("text-1");
    created(m("2", "me", "", 1));
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("text-2");
    expect(items[1]?.textContent).toContain("text-1");
  });

  it("未知の投稿者なら GET を取り直し、その応答を描画する", async () => {
    apiFetch.mockResolvedValueOnce(ok([]));
    renderView();
    await screen.findByText("まだメッセージはありません");
    apiFetch.mockResolvedValueOnce(ok([m("5", "u3", "新人", 1)]));
    created(m("5", "u3", "", 1));
    expect(await screen.findByText("新人")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("取得が終わる前の message.created は無視される", async () => {
    let resolve: (v: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    renderView();
    created(m("2", "u2", "", 2));
    await act(async () => resolve(ok([m("1", "u2", "はなこ", 1)])));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("onReconnect で取り直し、待つ間も一覧が残る", async () => {
    apiFetch.mockResolvedValueOnce(ok([m("1", "u2", "はなこ", 1)]));
    const { container } = renderView();
    await screen.findByText("text-1");
    let resolve: (v: unknown) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    act(() => live.onReconnect?.());
    expect(screen.getByText("text-1")).toBeTruthy();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    await act(async () => resolve(ok([m("1", "u2", "はなこ", 1), m("2", "u2", "はなこ", 2)])));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("重なった取り直しは最後に始めた応答だけを反映する", async () => {
    apiFetch.mockResolvedValueOnce(ok([]));
    renderView();
    await screen.findByText("まだメッセージはありません");
    let first: (v: unknown) => void = () => {};
    let second: (v: unknown) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((r) => (first = r)));
    apiFetch.mockReturnValueOnce(new Promise((r) => (second = r)));
    act(() => live.onReconnect?.());
    act(() => live.onReconnect?.());
    await act(async () => second(ok([m("2", "u2", "はなこ", 2)])));
    await act(async () => first(ok([m("1", "u2", "はなこ", 1)])));
    expect(screen.getByText("text-2")).toBeTruthy();
    expect(screen.queryByText("text-1")).toBeNull();
  });

  it("取り直しの失敗では toast を出し、一覧を残す", async () => {
    apiFetch.mockResolvedValueOnce(ok([m("1", "u2", "はなこ", 1)]));
    renderView();
    await screen.findByText("text-1");
    apiFetch.mockResolvedValueOnce({ ok: false, error: { code: "network", message: "切断" } });
    act(() => live.onReconnect?.());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("切断"));
    expect(screen.getByText("text-1")).toBeTruthy();
  });

  it("chat-view と message-list に setInterval・setTimeout がない", () => {
    for (const file of ["chat-view.tsx", "message-list.tsx"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toContain("setInterval");
      expect(source).not.toContain("setTimeout");
    }
  });

  describe("投稿フォームとの組み込み", () => {
    const mine = m("9", "me", "わたし", 9);
    function post(result: unknown) {
      apiFetch.mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method === "POST" ? result : ok([m("1", "u2", "はなこ", 1)])),
      );
    }

    it("主操作（bg-primary）のボタンは「送信」だけ", async () => {
      apiFetch.mockResolvedValue(ok([m("1", "u2", "はなこ", 1)]));
      renderView();
      await screen.findByText("text-1");
      const primary = screen
        .getAllByRole("button")
        .filter((button) => button.className.includes("bg-primary"));
      expect(primary.map((button) => button.textContent)).toEqual(["送信"]);
    });

    it("送信に成功すると末尾に描画され、同じ id の message.created で二重にならない", async () => {
      post({ ok: true, data: { message: mine } });
      renderView();
      await screen.findByText("text-1");
      await userEvent.type(screen.getByLabelText("メッセージ"), "hi{Enter}");
      expect(await screen.findByText("text-9")).toBeTruthy();
      created(mine);
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("先に message.created を受け取っても、送信の応答で二重にならない", async () => {
      let resolve: (v: unknown) => void = () => {};
      apiFetch.mockImplementation((_url: string, init?: { method?: string }) =>
        init?.method === "POST"
          ? new Promise((r) => (resolve = r))
          : Promise.resolve(ok([m("1", "u2", "はなこ", 1)])),
      );
      renderView();
      await screen.findByText("text-1");
      await userEvent.type(screen.getByLabelText("メッセージ"), "hi{Enter}");
      created(mine);
      await act(async () => resolve({ ok: true, data: { message: mine } }));
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("空状態の「メッセージを入力する」で入力欄にフォーカスが移る", async () => {
      apiFetch.mockResolvedValue(ok([]));
      renderView();
      await userEvent.click(await screen.findByRole("button", { name: "メッセージを入力する" }));
      expect(screen.getByLabelText("メッセージ")).toHaveFocus();
    });
  });

  describe("group.updated", () => {
    it("この画面のグループならヘッダーのグループ名が変わり、メッセージが残る", async () => {
      apiFetch.mockResolvedValue(ok([m("1", "u2", "はなこ", 1)]));
      renderView();
      await screen.findByText("text-1");
      act(() => {
        live.handlers["group.updated"]?.({ group: { id: "g1", name: "新しい名前" } });
      });
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("新しい名前");
      expect(screen.getByText("text-1")).toBeTruthy();
      expect(useLiveEvents).toHaveBeenCalled();
    });

    it("別のグループなら変わらない", async () => {
      apiFetch.mockResolvedValue(ok([]));
      renderView();
      act(() => {
        live.handlers["group.updated"]?.({ group: { id: "other", name: "別" } });
      });
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("雑談");
    });
  });
});
