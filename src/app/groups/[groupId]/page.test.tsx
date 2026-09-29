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
vi.mock("@/components/chat-view", () => ({
  ChatView: (props: { groupName: string }) => <h1>{props.groupName}</h1>,
}));

const { default: ChatPage } = await import("./page");

async function newUser(name: string): Promise<{ id: string; name: string }> {
  const user = { id: crypto.randomUUID(), name };
  await createUserRepository(db).insert(user);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createDb(":memory:");
});

describe("ChatPage", () => {
  it("利用者がいなければ /start へリダイレクトする", async () => {
    requireCurrentUserInPage.mockImplementation(() => {
      redirect("/start");
      throw new Error("NEXT_REDIRECT");
    });
    await expect(ChatPage({ params: Promise.resolve({ groupId: "x" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirect).toHaveBeenCalledWith("/start");
  });

  it("メンバーには h1 が1つあり、グループ名が出る", async () => {
    const user = await newUser("たろう");
    const group = createGroup("雑談", user.id);
    await createGroupRepository(db).insert(group);
    requireCurrentUserInPage.mockResolvedValue(user);
    render(await ChatPage({ params: Promise.resolve({ groupId: group.id }) }));
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("雑談");
  });

  it("メンバーでない利用者には notFound を呼ぶ", async () => {
    const owner = await newUser("a");
    const other = await newUser("b");
    const group = createGroup("雑談", owner.id);
    await createGroupRepository(db).insert(group);
    requireCurrentUserInPage.mockResolvedValue(other);
    await expect(ChatPage({ params: Promise.resolve({ groupId: group.id }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalled();
  });

  it("存在しないグループIDには notFound を呼ぶ", async () => {
    requireCurrentUserInPage.mockResolvedValue(await newUser("a"));
    await expect(
      ChatPage({ params: Promise.resolve({ groupId: crypto.randomUUID() }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
