import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { MessageComposer, MESSAGE_INPUT_ID } = await import("./message-composer");

const sent = {
  id: "m1",
  groupId: "g1",
  senderId: "me",
  senderName: "わたし",
  text: "hi",
  sentAt: new Date(2026, 8, 28, 9, 5).toISOString(),
};

const onSent = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function setup() {
  render(<MessageComposer groupId="g1" onSent={onSent} />);
  return screen.getByLabelText("メッセージ") as HTMLTextAreaElement;
}

function setText(input: HTMLTextAreaElement, value: string) {
  return userEvent.click(input).then(() => userEvent.paste(value));
}

const sendButton = () => screen.getByRole("button", { name: /^送信/ });

describe("MessageComposer", () => {
  it("入力欄がラベルで取得でき、textarea で id が定数と一致する", () => {
    const input = setup();
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.id).toBe(MESSAGE_INPUT_ID);
  });

  it("空・空白だけの間は送信ボタンが無効", async () => {
    const input = setup();
    expect(sendButton()).toBeDisabled();
    await setText(input, "   ");
    expect(sendButton()).toBeDisabled();
    await userEvent.type(input, "a");
    expect(sendButton()).toBeEnabled();
  });

  it("送信ボタンで POST し、成功すると onSent・空・フォーカス・トーストなし", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { message: sent } });
    const input = setup();
    await userEvent.type(input, "hi");
    await userEvent.click(sendButton());
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(sent));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/messages", {
      method: "POST",
      body: { text: "hi" },
    });
    expect(input.value).toBe("");
    expect(input).toHaveFocus();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Enter で送信し、改行は入らない", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { message: sent } });
    const input = setup();
    await userEvent.type(input, "hi{Enter}");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]?.[1]).toEqual({ method: "POST", body: { text: "hi" } });
  });

  it("Shift+Enter は改行で、送信しない", async () => {
    const input = setup();
    await userEvent.type(input, "a{Shift>}{Enter}{/Shift}b");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(input.value).toBe("a\nb");
  });

  it("IME 変換中の Enter では送信しない", async () => {
    const input = setup();
    await userEvent.type(input, "a");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("空のとき Enter を押しても送信しない", async () => {
    const input = setup();
    await userEvent.type(input, "  {Enter}");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("送信中はボタンが無効で「送信中…」、入力欄は有効、Enter で二重送信しない", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const input = setup();
    await userEvent.type(input, "hi{Enter}");
    expect(await screen.findByRole("button", { name: "送信中…" })).toBeDisabled();
    expect(input).toBeEnabled();
    await userEvent.type(input, "{Enter}");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("900文字では残り文字数を出さず、901文字で残り99文字、1000文字で残り0文字", async () => {
    const input = setup();
    await setText(input, "a".repeat(900));
    expect(screen.queryByText(/残り/)).toBeNull();
    await userEvent.type(input, "a");
    expect(screen.getByText("残り 99文字")).toBeTruthy();
    await userEvent.paste("a".repeat(99));
    expect(screen.getByText("残り 0文字")).toBeTruthy();
    expect(sendButton()).toBeEnabled();
  });

  it("1001文字では超過を出し、送信できない", async () => {
    const input = setup();
    await setText(input, "a".repeat(1001));
    const note = screen.getByText("1文字オーバーしています");
    expect(sendButton()).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(note.id);
    await userEvent.type(input, "{Enter}");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("前後の空白を除いて1000文字なら送信できる", async () => {
    const input = setup();
    await setText(input, ` ${"a".repeat(1000)} `);
    expect(sendButton()).toBeEnabled();
  });

  it("通信エラーではトーストを出し、入力を残して文言を戻す", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "network", message: "通信に失敗" } });
    const input = setup();
    await userEvent.type(input, "hi");
    await userEvent.click(sendButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("通信に失敗"));
    expect(input.value).toBe("hi");
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("not_found ではトーストを出す", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "グループが見つかりません" },
    });
    const input = setup();
    await userEvent.type(input, "hi{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("グループが見つかりません"));
  });

  it("validation は入力欄の直下に出し、トーストは出さず、入力を変えると消える", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "validation", message: "入力が不正です" },
    });
    const input = setup();
    await userEvent.type(input, "hi{Enter}");
    const note = await screen.findByText("入力が不正です");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(note.id);
    expect(toast.error).not.toHaveBeenCalled();
    await userEvent.type(input, "x");
    expect(screen.queryByText("入力が不正です")).toBeNull();
  });

  it("フォームが sticky bottom-0 である", () => {
    const input = setup();
    const form = input.closest("form");
    expect(form?.className).toContain("sticky");
    expect(form?.className).toContain("bottom-0");
  });
});
