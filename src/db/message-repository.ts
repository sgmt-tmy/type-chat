import { asc, eq, sql } from "drizzle-orm";
import type { Message } from "../message";
import type { Db } from "./client";
import { messages } from "./schema";

export type MessageRepository = {
  insert(message: Message): Promise<void>;
  listByGroup(groupId: string): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  delete(id: string): Promise<boolean>;
};

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    groupId: row.groupId,
    senderId: row.senderId,
    text: row.text,
    sentAt: row.sentAt,
  };
}

export function createMessageRepository(db: Db): MessageRepository {
  return {
    async insert(message) {
      db.insert(messages)
        .values({
          id: message.id,
          groupId: message.groupId,
          senderId: message.senderId,
          text: message.text,
          sentAt: message.sentAt,
        })
        .run();
    },
    async listByGroup(groupId) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.groupId, groupId))
        .orderBy(asc(messages.sentAt), sql`rowid`)
        .all()
        .map(toMessage);
    },
    async findById(id) {
      const row = db.select().from(messages).where(eq(messages.id, id)).get();
      return row ? toMessage(row) : null;
    },
    async delete(id) {
      return db.delete(messages).where(eq(messages.id, id)).run().changes > 0;
    },
  };
}
