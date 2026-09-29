import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("title が h2、description が文として表示される", () => {
    render(
      <EmptyState
        title="まだグループがありません"
        description="グループを作成しましょう"
        action={<Button>作成</Button>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "まだグループがありません" }),
    ).toBeInTheDocument();
    expect(screen.getByText("グループを作成しましょう").tagName).toBe("P");
  });

  it("action のボタンを押すと onClick が呼ばれる", async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="t"
        description="d"
        action={<Button onClick={onClick}>作成</Button>}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
