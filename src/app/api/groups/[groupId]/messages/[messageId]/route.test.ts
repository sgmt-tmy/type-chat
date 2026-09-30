import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createMessageRepository } from "@/db/message-repository";
import { createUserRepository } from "@/db/user-repository";
import { createGroup } from "@/group";
import { postMessageToGroup } from "@/message";
import { subscribe, type LiveEvent } from "@/server/events";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { DELETE } = await import("./route");
const { GET } = await import("../route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function del(groupId: string, messageId: string, userId: string | null) {
  return DELETE(
    new Request(`http://localhost/api/groups/${groupId}/messages/${messageId}`, {
      method: "DELETE",
      headers: userId ? { cookie: `type_chat_user_id=${userId}` } : {},
    }),
    { params: Promise.resolve({ groupId, messageId }) },
  );
}

async function setup() {
  const owner = await newUser("たろう");
  const member = await newUser("はなこ");
  const outsider = await newUser("外部");
  const g = createGroup("雑談", owner);
  g.members.push(member);
  await createGroupRepository(db).insert(g);
  const m = postMessageToGroup(g, owner, "hi");
  await createMessageRepository(db).insert(m);
  return { owner, member, outsider, g, m };
}

const NOT_FOUND = { error: { code: "not_found", message: "メッセージが見つかりません" } };

beforeEach(() => {
  db = createDb(":memory:");
});

describe("DELETE /api/groups/[groupId]/messages/[messageId]", () => {
  it("投稿者は 204 で削除でき、一覧から消え、別のメンバーに message.deleted が届く", async () => {
    const { owner, member, g, m } = await setup();
    const got: LiveEvent[] = [];
    const off = subscribe(member, (e) => got.push(e));
    const res = await del(g.id, m.id, owner);
    off();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      type: "message.deleted",
      data: { groupId: g.id, messageId: m.id },
    });
    const list = await GET(
      new Request(`http://localhost/api/groups/${g.id}/messages`, {
        headers: { cookie: `type_chat_user_id=${owner}` },
      }),
      { params: Promise.resolve({ groupId: g.id }) },
    );
    expect((await list.json()).messages).toEqual([]);
  });

  it("投稿者でないメンバーは 403 で、メッセージが残る", async () => {
    const { member, g, m } = await setup();
    const res = await del(g.id, m.id, member);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "メッセージを削除できるのは投稿者のみです" },
    });
    expect(await createMessageRepository(db).findById(m.id)).not.toBeNull();
  });

  it("メンバーでない・存在しないメッセージ・存在しないグループは 404", async () => {
    const { owner, outsider, g, m } = await setup();
    for (const res of [
      await del(g.id, m.id, outsider),
      await del(g.id, crypto.randomUUID(), owner),
      await del(crypto.randomUUID(), m.id, owner),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
  });

  it("別のグループのメッセージIDは 404 で、メッセージが残る", async () => {
    const { owner, m } = await setup();
    const other = createGroup("別", owner);
    await createGroupRepository(db).insert(other);
    const res = await del(other.id, m.id, owner);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(await createMessageRepository(db).findById(m.id)).not.toBeNull();
  });

  it("Cookie がなければ 401", async () => {
    const { g, m } = await setup();
    const res = await del(g.id, m.id, null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
