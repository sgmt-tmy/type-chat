import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createMessageRepository } from "@/db/message-repository";
import { createUserRepository } from "@/db/user-repository";
import { createGroup } from "@/group";
import { subscribe, type LiveEvent } from "@/server/events";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { GET, POST } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function headers(userId: string | null): Record<string, string> {
  return userId ? { cookie: `type_chat_user_id=${userId}` } : {};
}

function get(groupId: string, userId: string | null) {
  return GET(
    new Request(`http://localhost/api/groups/${groupId}/messages`, { headers: headers(userId) }),
    { params: Promise.resolve({ groupId }) },
  );
}

function post(groupId: string, userId: string | null, body: unknown) {
  return POST(
    new Request(`http://localhost/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { ...headers(userId), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId }) },
  );
}

async function setup() {
  const u = await newUser("たろう");
  const other = await newUser("外部");
  const g = createGroup("雑談", u);
  await createGroupRepository(db).insert(g);
  return { u, other, g };
}

const NOT_FOUND = { error: { code: "not_found", message: "グループが見つかりません" } };

beforeEach(() => {
  db = createDb(":memory:");
});

describe("GET /api/groups/[groupId]/messages", () => {
  it("sentAt 昇順で名前つきに返し、sentAt は ISO 文字列", async () => {
    const { u, g } = await setup();
    const repo = createMessageRepository(db);
    await repo.insert({ id: "m2", groupId: g.id, senderId: u, text: "b", sentAt: new Date(2000) });
    await repo.insert({ id: "m1", groupId: g.id, senderId: u, text: "a", sentAt: new Date(1000) });
    const res = await get(g.id, u);
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toEqual([
      {
        id: "m1",
        groupId: g.id,
        senderId: u,
        senderName: "たろう",
        text: "a",
        sentAt: new Date(1000).toISOString(),
      },
      {
        id: "m2",
        groupId: g.id,
        senderId: u,
        senderName: "たろう",
        text: "b",
        sentAt: new Date(2000).toISOString(),
      },
    ]);
  });

  it("0件なら空配列", async () => {
    const { u, g } = await setup();
    const res = await get(g.id, u);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const { other, g } = await setup();
    const a = await get(g.id, other);
    const b = await get(crypto.randomUUID(), other);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual(NOT_FOUND);
    expect(await b.json()).toEqual(NOT_FOUND);
  });

  it("Cookie がなければ 401", async () => {
    const res = await get(crypto.randomUUID(), null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});

describe("POST /api/groups/[groupId]/messages", () => {
  it("201 でメッセージを返し、一覧の末尾に入り、message.created が発行される", async () => {
    const { u, g } = await setup();
    const events: LiveEvent[] = [];
    const off = subscribe(u, (e) => events.push(e));
    const res = await post(g.id, u, { text: "  こんにちは  " });
    off();
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message).toMatchObject({
      groupId: g.id,
      senderId: u,
      senderName: "たろう",
      text: "こんにちは",
    });
    expect(typeof message.sentAt).toBe("string");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "message.created",
      data: { message: { id: message.id } },
    });
    const list = (await (await get(g.id, u)).json()).messages;
    expect(list[list.length - 1].id).toBe(message.id);
  });

  it("空・1001文字は 400 で増えない", async () => {
    const { u, g } = await setup();
    const empty = await post(g.id, u, { text: "   " });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({
      error: { code: "validation", message: "メッセージは空にできません" },
    });
    const long = await post(g.id, u, { text: "a".repeat(1001) });
    expect(long.status).toBe(400);
    expect((await long.json()).error.message).toBe("メッセージは1000文字以内にしてください");
    expect(await createMessageRepository(db).listByGroup(g.id)).toEqual([]);
  });

  it("text がなければ 400", async () => {
    const { u, g } = await setup();
    const res = await post(g.id, u, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation", message: "リクエストの形式が正しくありません" },
    });
  });

  it("メンバーでない利用者と存在しないIDは 404 で、増えず発行もされない", async () => {
    const { u, other, g } = await setup();
    let count = 0;
    const off = subscribe(u, () => count++);
    const a = await post(g.id, other, { text: "hi" });
    const b = await post(crypto.randomUUID(), other, { text: "hi" });
    off();
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(NOT_FOUND);
    expect(b.status).toBe(404);
    expect(count).toBe(0);
    expect(await createMessageRepository(db).listByGroup(g.id)).toEqual([]);
  });

  it("Cookie がなければ 401 で増えない", async () => {
    const { g } = await setup();
    const res = await post(g.id, null, { text: "hi" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    expect(await createMessageRepository(db).listByGroup(g.id)).toEqual([]);
  });
});
