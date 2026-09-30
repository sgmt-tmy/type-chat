import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { createGroup } from "@/group";

let db: Db;
const requireCurrentUserInPage = vi.fn();
const redirect = vi.fn();
const notFound = vi.fn();

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));
vi.mock("@/server/session", () => ({
  requireCurrentUserInPage: () => requireCurrentUserInPage(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/group-settings-view", () => ({
  GroupSettingsView: (props: { users: { id: string; name: string }[] }) => (
    <div>
      <h1>グループ設定</h1>
      <ul aria-label="users">
        {props.users.map((u) => (
          <li key={u.id}>{u.name}</li>
        ))}
      </ul>
    </div>
  ),
}));

const { default: GroupSettingsPage } = await import("./page");

async function newUser(name: string): Promise<{ id: string; name: string }> {
  const user = { id: crypto.randomUUID(), name };
  await createUserRepository(db).insert(user);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createDb(":memory:");
});

describe("GroupSettingsPage", () => {
  it("利用者がいなければ /start へリダイレクトする", async () => {
    requireCurrentUserInPage.mockImplementation(() => {
      redirect("/start");
      throw new Error("NEXT_REDIRECT");
    });
    await expect(GroupSettingsPage({ params: Promise.resolve({ groupId: "x" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirect).toHaveBeenCalledWith("/start");
  });

  it("メンバーには h1 が1つあり「グループ設定」である", async () => {
    const user = await newUser("たろう");
    const group = createGroup("雑談", user.id);
    await createGroupRepository(db).insert(group);
    requireCurrentUserInPage.mockResolvedValue(user);
    render(await GroupSettingsPage({ params: Promise.resolve({ groupId: group.id }) }));
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("グループ設定");
  });

  it("登録済みの利用者を登録順に users として渡す", async () => {
    const user = await newUser("たろう");
    await newUser("はなこ");
    await newUser("じろう");
    const group = createGroup("雑談", user.id);
    await createGroupRepository(db).insert(group);
    requireCurrentUserInPage.mockResolvedValue(user);
    render(await GroupSettingsPage({ params: Promise.resolve({ groupId: group.id }) }));
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["たろう", "はなこ", "じろう"]);
  });

  it("メンバーでない利用者には notFound を呼ぶ", async () => {
    const owner = await newUser("a");
    const other = await newUser("b");
    const group = createGroup("雑談", owner.id);
    await createGroupRepository(db).insert(group);
    requireCurrentUserInPage.mockResolvedValue(other);
    await expect(
      GroupSettingsPage({ params: Promise.resolve({ groupId: group.id }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("存在しないグループIDには notFound を呼ぶ", async () => {
    requireCurrentUserInPage.mockResolvedValue(await newUser("a"));
    await expect(
      GroupSettingsPage({ params: Promise.resolve({ groupId: crypto.randomUUID() }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
