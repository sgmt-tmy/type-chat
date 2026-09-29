import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
type LiveOptions = { handlers: Record<string, () => void>; onReconnect?: () => void };
let live: LiveOptions;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/use-live-events", () => ({
  useLiveEvents: (options: LiveOptions) => {
    live = options;
  },
}));

const { GroupList } = await import("./group-list");
const { CreateGroupForm } = await import("./create-group-form");

const g1 = { id: "g1", name: "雑談", ownerId: "u1", memberCount: 3 };
const g2 = { id: "g2", name: "仕事", ownerId: "u2", memberCount: 1 };

function ok(groups: unknown[]) {
  return { ok: true, data: { groups } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupList", () => {
  it("マウントで GET /api/groups を1回呼び、取得中は Skeleton を出す", () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<GroupList currentUserId="u1" />);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/groups");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("まだグループがありません")).toBeNull();
  });

  it("行にグループ名・メンバー数・リンクが出て、オーナーだけバッジが付く", async () => {
    apiFetch.mockResolvedValue(ok([g1, g2]));
    render(<GroupList currentUserId="u1" />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("雑談");
    expect(items[0]).toHaveTextContent("メンバー 3人");
    expect(items[1]).toHaveTextContent("メンバー 1人");
    expect(screen.getByRole("link", { name: /雑談/ })).toHaveAttribute("href", "/groups/g1");
    expect(screen.getByRole("link", { name: /仕事/ })).toHaveAttribute("href", "/groups/g2");
    expect(screen.getAllByText("オーナー")).toHaveLength(1);
    expect(items[0]).toHaveTextContent("オーナー");
    expect(items[1]).not.toHaveTextContent("オーナー");
  });

  it("0件なら空状態を出し、ボタンで入力欄にフォーカスする", async () => {
    apiFetch.mockResolvedValue(ok([]));
    render(
      <>
        <CreateGroupForm />
        <GroupList currentUserId="u1" />
      </>,
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "まだグループがありません" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("グループ名を入力して、最初のグループを作りましょう"),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "グループ名を入力する" });
    expect(button.className).not.toContain("bg-primary");
    await userEvent.click(button);
    expect(screen.getByLabelText("グループ名")).toHaveFocus();
  });

  it("最初の取得が失敗したら toast と再読み込みボタンを出し、押すと取り直す", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, error: { code: "network", message: "通信失敗" } });
    render(<GroupList currentUserId="u1" />);
    expect(await screen.findByText("グループを読み込めませんでした")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("通信失敗");
    apiFetch.mockResolvedValueOnce(ok([g1]));
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("雑談")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("group.updated / group.deleted / onReconnect で取り直す", async () => {
    apiFetch.mockResolvedValueOnce(ok([g1, g2]));
    render(<GroupList currentUserId="u1" />);
    await screen.findByText("仕事");

    apiFetch.mockResolvedValueOnce(ok([{ ...g1, name: "雑談2" }, g2]));
    await act(async () => live.handlers["group.updated"]());
    expect(await screen.findByText("雑談2")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(2);

    apiFetch.mockResolvedValueOnce(ok([{ ...g1, name: "雑談2" }]));
    await act(async () => live.handlers["group.deleted"]());
    await waitFor(() => expect(screen.queryByText("仕事")).toBeNull());
    expect(apiFetch).toHaveBeenCalledTimes(3);

    apiFetch.mockResolvedValueOnce(ok([]));
    await act(async () => live.onReconnect?.());
    expect(apiFetch).toHaveBeenCalledTimes(4);
  });

  it("取り直し中は一覧が残り、古い応答で上書きしない", async () => {
    apiFetch.mockResolvedValueOnce(ok([g1]));
    const { container } = render(<GroupList currentUserId="u1" />);
    await screen.findByText("雑談");

    let resolveFirst: (value: unknown) => void = () => {};
    let resolveSecond: (value: unknown) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    apiFetch.mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
    act(() => live.onReconnect?.());
    act(() => live.onReconnect?.());
    expect(screen.getByText("雑談")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();

    await act(async () => resolveSecond(ok([g2])));
    expect(await screen.findByText("仕事")).toBeInTheDocument();
    await act(async () => resolveFirst(ok([g1])));
    expect(screen.getByText("仕事")).toBeInTheDocument();
    expect(screen.queryByText("雑談")).toBeNull();
  });

  it("取り直しが失敗しても一覧が残る", async () => {
    apiFetch.mockResolvedValueOnce(ok([g1]));
    render(<GroupList currentUserId="u1" />);
    await screen.findByText("雑談");
    apiFetch.mockResolvedValueOnce({ ok: false, error: { code: "network", message: "通信失敗" } });
    await act(async () => live.onReconnect?.());
    expect(toast.error).toHaveBeenCalledWith("通信失敗");
    expect(screen.getByText("雑談")).toBeInTheDocument();
  });

  it("setInterval と setTimeout を使わない", () => {
    const source = readFileSync(path.join(import.meta.dirname, "group-list.tsx"), "utf8");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });
});
