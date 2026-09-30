import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { AddMemberForm, ADD_MEMBER_SELECT_ID } = await import("./add-member-form");

const candidates = [
  { id: "u2", name: "はなこ" },
  { id: "u3", name: "じろう" },
];
const detail = { id: "g1", name: "雑談", ownerId: "u1", members: [{ id: "u1", name: "たろう" }] };

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

function renderForm(list = candidates) {
  const onAdded = vi.fn();
  const view = render(<AddMemberForm groupId="g1" candidates={list} onAdded={onAdded} />);
  return { ...view, onAdded };
}

const addButton = () => screen.getByRole("button", { name: /^追加/ });
const trigger = () => screen.getByLabelText("追加する利用者");

async function choose(name: string) {
  await userEvent.click(trigger());
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("AddMemberForm", () => {
  it("h3「メンバーを追加」がある", () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 3, name: "メンバーを追加" })).toBeTruthy();
  });

  it("Select が候補を渡した順に並べる", async () => {
    renderForm();
    expect(trigger()).toHaveAttribute("id", ADD_MEMBER_SELECT_ID);
    expect(screen.getByText("利用者を選択")).toBeTruthy();
    await userEvent.click(trigger());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["はなこ", "じろう"]);
  });

  it("選ぶまで追加は無効で、選ぶと有効。主操作の見た目ではない", async () => {
    renderForm();
    expect(addButton()).toBeDisabled();
    expect(addButton().className).not.toContain("bg-primary");
    await choose("はなこ");
    expect(addButton()).toBeEnabled();
  });

  it("候補が空なら案内だけが出る", () => {
    renderForm([]);
    expect(screen.getByText("追加できる利用者がいません")).toBeTruthy();
    expect(screen.queryByLabelText("追加する利用者")).toBeNull();
    expect(screen.queryByRole("button", { name: /追加/ })).toBeNull();
  });

  it("追加で POST が送られ、確認ダイアログは出ない。送信中は追加中…", async () => {
    let resolve: (v: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    await choose("はなこ");
    await userEvent.click(addButton());
    expect(apiFetch).toHaveBeenCalledWith("/api/groups/g1/members", {
      method: "POST",
      body: { userId: "u2" },
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "追加中…" })).toBeDisabled();
    resolve({ ok: true, data: { group: detail } });
    await waitFor(() => expect(screen.getByRole("button", { name: "追加" })).toBeDisabled());
  });

  it("成功するとトースト・onAdded・未選択に戻る", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { group: detail } });
    const { onAdded } = renderForm();
    await choose("はなこ");
    await userEvent.click(addButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("はなこさんを追加しました"));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith(detail);
    expect(screen.getByText("利用者を選択")).toBeTruthy();
  });

  it("失敗するとtoast.errorで、onAddedは呼ばれず選択が残る", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "forbidden", message: "だめ" } });
    const { onAdded } = renderForm();
    await choose("じろう");
    await userEvent.click(addButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("だめ"));
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "追加" })).toBeEnabled();
    expect(trigger().textContent).toBe("じろう");
  });

  it("選択中の利用者が候補から消えると未選択に戻る", async () => {
    const { rerender } = renderForm();
    await choose("はなこ");
    rerender(
      <AddMemberForm groupId="g1" candidates={[{ id: "u3", name: "じろう" }]} onAdded={vi.fn()} />,
    );
    expect(screen.getByText("利用者を選択")).toBeTruthy();
    expect(addButton()).toBeDisabled();
  });

  it("ソースに setInterval と setTimeout がない", () => {
    const src = readFileSync(path.join(__dirname, "add-member-form.tsx"), "utf8");
    expect(src).not.toContain("setInterval");
    expect(src).not.toContain("setTimeout");
  });
});
