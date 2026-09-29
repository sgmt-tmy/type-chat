import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createUserRepository } from "@/db/user-repository";
import { countSubscribers, formatSseEvent, publish, type LiveEvent } from "@/server/events";
import { createUser } from "@/user";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const route = await import("./route");

const decoder = new TextDecoder();

function makeEvent(groupId: string): LiveEvent {
  return { type: "group.deleted", data: { groupId } };
}

async function setup() {
  const user = createUser("たろう");
  await createUserRepository(db).insert(user);
  const controller = new AbortController();
  const request = new Request("http://localhost/api/events", {
    headers: { cookie: `type_chat_user_id=${user.id}` },
    signal: controller.signal,
  });
  const response = await route.GET(request);
  return { user, controller, response };
}

beforeEach(() => {
  db = createDb(":memory:");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/events", () => {
  it("Cookie がなければ 401 で購読しない", async () => {
    const res = await route.GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });

  it("200 とヘッダー、購読が1つ増える", async () => {
    const { user, controller, response } = await setup();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/event-stream/);
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(countSubscribers(user.id)).toBe(1);
    controller.abort();
  });

  it("発行したイベントが読め、別の利用者宛は現れない", async () => {
    const { user, controller, response } = await setup();
    const reader = response.body!.getReader();
    publish(makeEvent("other"), ["someone-else"]);
    const own = makeEvent("mine");
    publish(own, [user.id]);
    const { value } = await reader.read();
    expect(decoder.decode(value)).toBe(formatSseEvent(own));
    controller.abort();
  });

  it("25秒で ping を書く", async () => {
    vi.useFakeTimers();
    const { controller, response } = await setup();
    const reader = response.body!.getReader();
    await vi.advanceTimersByTimeAsync(25000);
    const { value } = await reader.read();
    expect(decoder.decode(value)).toBe(": ping\n\n");
    controller.abort();
  });

  it("abort で購読解除・ストリーム終了、その後のタイマーで書き込まれない", async () => {
    vi.useFakeTimers();
    const { user, controller, response } = await setup();
    const reader = response.body!.getReader();
    controller.abort();
    expect(countSubscribers(user.id)).toBe(0);
    expect((await reader.read()).done).toBe(true);
    await vi.advanceTimersByTimeAsync(25000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("すでに abort されたリクエストは購読を残さない", async () => {
    const user = createUser("はなこ");
    await createUserRepository(db).insert(user);
    const controller = new AbortController();
    controller.abort();
    await route.GET(
      new Request("http://localhost/api/events", {
        headers: { cookie: `type_chat_user_id=${user.id}` },
        signal: controller.signal,
      }),
    );
    expect(countSubscribers(user.id)).toBe(0);
  });

  it("cancel で購読解除", async () => {
    const { user, response } = await setup();
    await response.body!.cancel();
    expect(countSubscribers(user.id)).toBe(0);
  });

  it("dynamic と runtime をエクスポートする", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
  });
});
