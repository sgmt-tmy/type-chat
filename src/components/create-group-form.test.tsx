import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn() };
const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { CreateGroupForm, CREATE_GROUP_NAME_INPUT_ID } = await import("./create-group-form");

beforeEach(() => {
  vi.clearAllMocks();
});

async function submit(name: string) {
  const input = screen.getByLabelText("グループ名");
  if (name) await userEvent.type(input, name);
  await userEvent.click(screen.getByRole("button", { name: "作成" }));
}

describe("CreateGroupForm", () => {
  it("入力欄がラベルで取得でき、id が定数と一致する", () => {
    render(<CreateGroupForm />);
    expect(screen.getByLabelText("グループ名")).toHaveAttribute("id", CREATE_GROUP_NAME_INPUT_ID);
  });

  it("POST /api/groups を呼び、成功したらトーストと移動をする", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { id: "g1" } } });
    render(<CreateGroupForm />);
    await submit("雑談");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/groups/g1"));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups", {
      method: "POST",
      body: { name: "雑談" },
    });
    expect(toast.success).toHaveBeenCalledWith("グループを作成しました");
  });

  it("Enter キーで送信できる", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: { id: "g1" } } });
    render(<CreateGroupForm />);
    await userEvent.type(screen.getByLabelText("グループ名"), "雑談{Enter}");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });

  it("送信中は無効で「作成中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    render(<CreateGroupForm />);
    await submit("雑談");
    expect(await screen.findByRole("button", { name: "作成中…" })).toBeDisabled();
  });

  it("空白だけならAPIを呼ばずエラーを出す", async () => {
    render(<CreateGroupForm />);
    await submit("  ");
    const message = await screen.findByText("グループ名は空にできません");
    expect(apiFetch).not.toHaveBeenCalled();
    const input = screen.getByLabelText("グループ名");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
  });

  it("51文字ならAPIを呼ばずエラーを出す", async () => {
    render(<CreateGroupForm />);
    await submit("あ".repeat(51));
    await screen.findByText("グループ名は50文字以内で入力してください");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("グループ名")).toHaveAttribute("aria-invalid", "true");
  });

  it("エラー後に値を変えるとエラーが消える", async () => {
    render(<CreateGroupForm />);
    await submit("");
    await screen.findByText("グループ名は空にできません");
    await userEvent.type(screen.getByLabelText("グループ名"), "a");
    expect(screen.queryByText("グループ名は空にできません")).toBeNull();
    expect(screen.getByLabelText("グループ名")).not.toHaveAttribute("aria-invalid");
  });

  it("validation の失敗は message を入力欄の直下に出す", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "validation", message: "だめです" },
    });
    render(<CreateGroupForm />);
    await submit("雑談");
    const message = await screen.findByText("だめです");
    expect(screen.getByLabelText("グループ名")).toHaveAttribute("aria-describedby", message.id);
  });

  it("通信エラーは toast.error で出し、文言と入力値が戻る", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "network", message: "通信失敗" } });
    render(<CreateGroupForm />);
    await submit("雑談");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("通信失敗"));
    expect(screen.queryByText("通信失敗")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "作成" })).toBeEnabled();
    expect(screen.getByLabelText("グループ名")).toHaveValue("雑談");
  });
});
