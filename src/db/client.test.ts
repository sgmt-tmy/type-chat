import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, type Db } from "./client";
import { groupMembers, groups, messages } from "./schema";

function rows(db: Db, query: string) {
  return db.all<Record<string, unknown>>(sql.raw(query));
}

describe("createDb", () => {
  it("4テーブルがある", () => {
    const db = createDb(":memory:");
    const names = rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["users", "groups", "group_members", "messages"]));
  });

  it("外部キーが有効", () => {
    const db = createDb(":memory:");
    expect(rows(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
  });

  it("messages に (group_id, sent_at) のインデックスがある", () => {
    const db = createDb(":memory:");
    const idx = rows(db, "PRAGMA index_list('messages')");
    const cols = idx.map((i) =>
      rows(db, `PRAGMA index_info('${String(i.name)}')`).map((c) => c.name),
    );
    expect(cols).toContainEqual(["group_id", "sent_at"]);
  });

  it("互いに独立したDBが返る", () => {
    const a = createDb(":memory:");
    const b = createDb(":memory:");
    a.insert(groups).values({ id: "g", name: "n", ownerId: "o", createdAt: new Date() }).run();
    expect(b.select().from(groups).all()).toEqual([]);
  });

  it("groups を消すと group_members と messages も消える", () => {
    const db = createDb(":memory:");
    const now = new Date();
    db.insert(groups).values({ id: "g", name: "n", ownerId: "o", createdAt: now }).run();
    db.insert(groupMembers).values({ groupId: "g", userId: "u", joinedAt: now }).run();
    db.insert(messages)
      .values({ id: "m", groupId: "g", senderId: "u", text: "hi", sentAt: now })
      .run();
    db.delete(groups).run();
    expect(db.select().from(groupMembers).all()).toEqual([]);
    expect(db.select().from(messages).all()).toEqual([]);
  });

  it("DBファイルのパスは定数で、環境変数を参照しない", () => {
    const src = readFileSync("src/db/client.ts", "utf8");
    expect(src).toContain('DB_FILE_PATH = "data/type-chat.db"');
    expect(src).not.toMatch(/process\s*\.\s*env/);
  });
});
