import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import type { Group } from "../group";
import type { Db } from "./client";
import { groupMembers, groups } from "./schema";

export type GroupRepository = {
  insert(group: Group): Promise<void>;
  findById(id: string): Promise<Group | null>;
  listByMember(userId: string): Promise<Group[]>;
  save(group: Group): Promise<void>;
  delete(id: string): Promise<boolean>;
};

export function createGroupRepository(db: Db): GroupRepository {
  function loadMembers(groupId: string): string[] {
    return db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(asc(groupMembers.joinedAt), sql`rowid`)
      .all()
      .map((r) => r.userId);
  }

  function toGroup(row: typeof groups.$inferSelect): Group {
    return { id: row.id, name: row.name, ownerId: row.ownerId, members: loadMembers(row.id) };
  }

  return {
    async insert(group) {
      db.transaction((tx) => {
        const now = new Date();
        tx.insert(groups)
          .values({ id: group.id, name: group.name, ownerId: group.ownerId, createdAt: now })
          .run();
        for (const userId of group.members) {
          tx.insert(groupMembers).values({ groupId: group.id, userId, joinedAt: now }).run();
        }
      });
    },
    async findById(id) {
      const row = db.select().from(groups).where(eq(groups.id, id)).get();
      return row ? toGroup(row) : null;
    },
    async listByMember(userId) {
      const rows = db
        .select()
        .from(groups)
        .where(
          inArray(
            groups.id,
            db
              .select({ id: groupMembers.groupId })
              .from(groupMembers)
              .where(eq(groupMembers.userId, userId)),
          ),
        )
        .orderBy(asc(groups.createdAt), sql`groups.rowid`)
        .all();
      return rows.map(toGroup);
    },
    async save(group) {
      db.transaction((tx) => {
        const existing = tx.select().from(groups).where(eq(groups.id, group.id)).get();
        if (!existing) {
          throw new DomainError("not_found", "グループが見つかりません");
        }
        tx.update(groups)
          .set({ name: group.name, ownerId: group.ownerId })
          .where(eq(groups.id, group.id))
          .run();
        const current = tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, group.id))
          .all()
          .map((r) => r.userId);
        const wanted = new Set(group.members);
        const currentSet = new Set(current);
        for (const userId of current) {
          if (!wanted.has(userId)) {
            tx.delete(groupMembers)
              .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)))
              .run();
          }
        }
        const now = new Date();
        for (const userId of group.members) {
          if (!currentSet.has(userId)) {
            tx.insert(groupMembers).values({ groupId: group.id, userId, joinedAt: now }).run();
          }
        }
      });
    },
    async delete(id) {
      return db.delete(groups).where(eq(groups.id, id)).run().changes > 0;
    },
  };
}
