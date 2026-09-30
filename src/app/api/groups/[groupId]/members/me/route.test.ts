import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { addMember, createGroup } from "@/group";
import { subscribe, type LiveEvent } from "@/server/events";

let db: Db;

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: () => db,
}));

const { DELETE } = await import("./route");

async function newUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await createUserRepository(db).insert({ id, name });
  return id;
}

function del(groupId: string, userId: string | null) {
  return DELETE(
    new Request(`http://localhost/api/groups/${groupId}/members/me`, {
      method: "DELETE",
      headers: userId ? { cookie: `type_chat_user_id=${userId}` } : {},
    }),
    { params: Promise.resolve({ groupId }) },
  );
}

async function prepare() {
  const owner = await newUser("たろう");
  const member = await newUser("はなこ");
  const outsider = await newUser("さぶろう");
  const base = createGroup("雑談", owner);
  await createGroupRepository(db).insert(base);
  const g = addMember(base, owner, member);
  await createGroupRepository(db).save(g);
  return { owner, member, outsider, g };
}

beforeEach(() => {
  db = createDb(":memory:");
});

describe("DELETE /api/groups/[groupId]/members/me", () => {
  it("メンバーが脱退すると 204 で、以後は 404 になり、オーナーと本人に group.updated が届く", async () => {
    const { owner, member, g } = await prepare();
    const ownerGot: LiveEvent[] = [];
    const memberGot: LiveEvent[] = [];
    const offs = [
      subscribe(owner, (e) => ownerGot.push(e)),
      subscribe(member, (e) => memberGot.push(e)),
    ];
    const res = await del(g.id, member);
    offs.forEach((off) => off());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(ownerGot).toHaveLength(1);
    expect(ownerGot[0]).toMatchObject({
      type: "group.updated",
      data: { group: { id: g.id, members: [owner] } },
    });
    expect(memberGot).toHaveLength(1);
    expect((await createGroupRepository(db).findById(g.id))?.members).toEqual([owner]);
    expect(await createGroupRepository(db).listByMember(member)).toEqual([]);
  });

  it("オーナーは 403 で変わらない", async () => {
    const { owner, member, g } = await prepare();
    const res = await del(g.id, owner);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "forbidden",
        message: "オーナーは脱退できません。先にオーナーを委譲してください",
      },
    });
    expect((await createGroupRepository(db).findById(g.id))?.members).toEqual([owner, member]);
  });

  it("メンバーでない利用者と存在しないIDには同じ 404", async () => {
    const { outsider, g } = await prepare();
    const a = await del(g.id, outsider);
    const b = await del(crypto.randomUUID(), outsider);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const body = await a.json();
    expect(body).toEqual({ error: { code: "not_found", message: "グループが見つかりません" } });
    expect(await b.json()).toEqual(body);
  });

  it("Cookie がなければ 401", async () => {
    const res = await del(crypto.randomUUID(), null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });
});
