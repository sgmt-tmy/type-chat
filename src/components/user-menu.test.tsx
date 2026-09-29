import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), refresh: vi.fn() };
const apiFetch = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("sonner", () => ({ toast }));

const { UserMenu } = await import("./user-menu");

beforeEach(() => {
  vi.clearAllMocks();
});

async function chooseSwitch() {
  render(<UserMenu userName="たろう" />);
  await userEvent.click(screen.getByRole("button", { name: "たろう" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "利用者を切り替える" }));
}

describe("UserMenu", () => {
  it("利用者名のボタンがあり、開くと切り替えの項目がある", async () => {
    render(<UserMenu userName="たろう" />);
    await userEvent.click(screen.getByRole("button", { name: "たろう" }));
    expect(await screen.findByRole("menuitem", { name: "利用者を切り替える" })).toBeInTheDocument();
  });

  it("切り替えると DELETE /api/session を呼び、成功したら /start へ移動する", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: null });
    await chooseSwitch();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/start"));
    expect(apiFetch).toHaveBeenCalledWith("/api/session", { method: "DELETE" });
    expect(toast.success).toHaveBeenCalledWith("利用を終了しました");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("失敗したら toast.error を出し、移動しない", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "network", message: "失敗" } });
    await chooseSwitch();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("失敗"));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
