import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

function setup(props: Partial<ConfirmDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="グループを削除しますか？"
      description="元に戻せません。"
      confirmLabel="削除する"
      pendingLabel="削除中…"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("alertdialog にタイトルと説明が表示される", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("グループを削除しますか？");
    expect(dialog).toHaveTextContent("元に戻せません。");
  });

  it("確定ボタンで onConfirm が1回呼ばれ、onOpenChange(false) は呼ばれない", async () => {
    const { onConfirm, onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("キャンセルで onOpenChange(false) が呼ばれ、onConfirm は呼ばれない", async () => {
    const { onConfirm, onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("pending のとき確定ボタンは無効で pendingLabel になり、キャンセルも無効", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: "削除中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
  });

  it("destructive のとき確定ボタンに bg-destructive が含まれる", () => {
    setup({ destructive: true });
    expect(screen.getByRole("button", { name: "削除する" }).className).toContain(
      "bg-destructive",
    );
  });
});
