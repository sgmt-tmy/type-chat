import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChatMessage,
  formatMessageTime,
  MessageList,
  type MessageListProps,
} from "./message-list";

const scrollTo = vi.fn();

function msg(id: string, senderId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    groupId: "g1",
    senderId,
    senderName: `name-${senderId}`,
    text: `text-${id}`,
    sentAt: new Date(2026, 8, 28, 9, 5).toISOString(),
    ...extra,
  };
}

function props(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    state: "loaded",
    messages: [],
    currentUserId: "me",
    onRetry: vi.fn(),
    onStartWriting: vi.fn(),
    ...over,
  };
}

function setScroll(scrollY: number) {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  fireEvent.scroll(window);
}

beforeEach(() => {
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  setScroll(1200);
  scrollTo.mockClear();
});

describe("formatMessageTime", () => {
  it("HH:mm にする", () => {
    expect(formatMessageTime(new Date(2026, 8, 28, 9, 5).toISOString())).toBe("09:05");
    expect(formatMessageTime(new Date(2026, 8, 28, 23, 59).toISOString())).toBe("23:59");
  });
});

describe("MessageList", () => {
  it("loading は Skeleton と aria-busy を出し、空状態を出さない", () => {
    const { container } = render(<MessageList {...props({ state: "loading" })} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.queryByText("まだメッセージはありません")).toBeNull();
  });

  it("0件は空状態を出し、ボタンで onStartWriting を呼ぶ", async () => {
    const p = props();
    render(<MessageList {...p} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "まだメッセージはありません",
    );
    expect(screen.getByText("最初のメッセージを送ってみましょう")).toBeTruthy();
    const button = screen.getByRole("button", { name: "メッセージを入力する" });
    expect(button.className).not.toContain("bg-primary");
    await userEvent.click(button);
    expect(p.onStartWriting).toHaveBeenCalledTimes(1);
  });

  it("failed は再読み込みで onRetry を呼ぶ", async () => {
    const p = props({ state: "failed" });
    render(<MessageList {...p} />);
    expect(screen.getByText("メッセージを読み込めませんでした")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it("自分と他人を区別し、他人だけ投稿者名が出る。時刻が出る", () => {
    render(
      <MessageList {...props({ messages: [msg("1", "me"), msg("2", "u2"), msg("3", "u2")] })} />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.className).toContain("justify-end");
    expect(items[0]?.textContent).not.toContain("name-me");
    expect(items[1]?.className).toContain("justify-start");
    expect(items[1]?.textContent).toContain("name-u2");
    const time = items[0]?.querySelector("time");
    expect(time?.textContent).toBe("09:05");
    expect(time?.getAttribute("dateTime")).toBe(msg("1", "me").sentAt);
  });

  it("本文は改行を保つ", () => {
    render(<MessageList {...props({ messages: [msg("1", "me", { text: "a\nb" })] })} />);
    const body = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "a\nb");
    expect(body.className).toContain("whitespace-pre-wrap");
  });

  it("loading から loaded で最下部へスクロールし、同じ messages の再描画ではしない", () => {
    const messages = [msg("1", "u2")];
    const { rerender } = render(<MessageList {...props({ state: "loading" })} />);
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<MessageList {...props({ messages })} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: document.documentElement.scrollHeight });
    scrollTo.mockClear();
    rerender(<MessageList {...props({ messages })} />);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("最下部にいれば他人の新着でスクロールする", () => {
    const first = [msg("1", "u2")];
    const { rerender } = render(<MessageList {...props({ messages: first })} />);
    setScroll(1200);
    scrollTo.mockClear();
    rerender(<MessageList {...props({ messages: [...first, msg("2", "u2")] })} />);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("最下部から離れていれば他人の新着でスクロールしないが、自分の新着ではする", () => {
    const first = [msg("1", "u2")];
    const { rerender } = render(<MessageList {...props({ messages: first })} />);
    setScroll(0);
    scrollTo.mockClear();
    const second = [...first, msg("2", "u2")];
    rerender(<MessageList {...props({ messages: second })} />);
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<MessageList {...props({ messages: [...second, msg("3", "me")] })} />);
    expect(scrollTo).toHaveBeenCalled();
  });
});
