import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { RenameGroupForm, RENAME_GROUP_NAME_INPUT_ID } = await import("./rename-group-form");

const detail = { id: "g1", name: "新", ownerId: "u1", members: [{ id: "u1", name: "たろう" }] };

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm(onRenamed = vi.fn(), currentName = "雑談") {
  const view = render(
    <RenameGroupForm groupId="g1" currentName={currentName} onRenamed={onRenamed} />,
  );
  return { ...view, onRenamed };
}

const input = () => screen.getByLabelText("グループ名");
const saveButton = () => screen.getByRole("button", { name: /保存/ });

describe("RenameGroupForm", () => {
  it("入力欄がラベルで取得でき、id と初期値が正しい", () => {
    renderForm();
    expect(input()).toHaveAttribute("id", RENAME_GROUP_NAME_INPUT_ID);
    expect(input()).toHaveValue("雑談");
  });

  it("変更がない間（前後の空白だけの差を含む）は保存が無効で、変えると有効になる", async () => {
    renderForm();
    expect(saveButton()).toBeDisabled();
    await userEvent.type(input(), "  ");
    expect(saveButton()).toBeDisabled();
    await userEvent.type(input(), "会");
    expect(saveButton()).toBeEnabled();
  });

  it("保存で PATCH が送られ、成功するとトーストと onRenamed が呼ばれる", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: detail } });
    const { onRenamed } = renderForm();
    await userEvent.clear(input());
    await userEvent.type(input(), "新");
    await userEvent.click(saveButton());
    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1", {
      method: "PATCH",
      body: { name: "新" },
    });
    expect(onRenamed).toHaveBeenCalledWith(detail);
    expect(toast.success).toHaveBeenCalledWith("グループ名を変更しました");
  });

  it("Enter キーで送信できる", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: detail } });
    renderForm();
    await userEvent.type(input(), "会{Enter}");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });

  it("送信中は無効で「保存中…」になる", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    renderForm();
    await userEvent.type(input(), "会");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("button", { name: "保存中…" })).toBeDisabled();
  });

  it("空にして送信するとAPIを呼ばずエラーを出す", async () => {
    renderForm();
    await userEvent.clear(input());
    await userEvent.type(input(), "  {Enter}");
    const message = await screen.findByText("グループ名は空にできません");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveAttribute("aria-describedby", message.id);
  });

  it("51文字ならAPIを呼ばずエラーを出し、値を変えるとエラーが消える", async () => {
    renderForm();
    await userEvent.clear(input());
    await userEvent.type(input(), `${"あ".repeat(51)}{Enter}`);
    await screen.findByText("グループ名は50文字以内で入力してください");
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.type(input(), "a");
    expect(screen.queryByText("グループ名は50文字以内で入力してください")).toBeNull();
    expect(input()).not.toHaveAttribute("aria-invalid");
  });

  it("validation の失敗は入力欄の直下に出し、toast.error は呼ばない", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "validation", message: "だめです" } });
    renderForm();
    await userEvent.type(input(), "会");
    await userEvent.click(saveButton());
    await screen.findByText("だめです");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("forbidden の失敗は toast.error で出し、onRenamed を呼ばず、値が残る", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", message: "グループ名の変更はオーナーのみ可能です" },
    });
    const { onRenamed } = renderForm();
    await userEvent.type(input(), "会");
    await userEvent.click(saveButton());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("グループ名の変更はオーナーのみ可能です"),
    );
    expect(onRenamed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(input()).toHaveValue("雑談会");
  });

  it("編集していなければ currentName の変更に追従し、編集中なら値を残す", async () => {
    const { rerender } = renderForm();
    rerender(<RenameGroupForm groupId="g1" currentName="別名" onRenamed={vi.fn()} />);
    expect(input()).toHaveValue("別名");
    await userEvent.type(input(), "X");
    rerender(<RenameGroupForm groupId="g1" currentName="さらに別名" onRenamed={vi.fn()} />);
    expect(input()).toHaveValue("別名X");
  });
});
