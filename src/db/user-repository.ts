import { asc, eq, sql } from "drizzle-orm";
import type { User } from "../user";
import type { Db } from "./client";
import { users } from "./schema";

export type UserRepository = {
  insert(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  list(): Promise<User[]>;
};

export function createUserRepository(db: Db): UserRepository {
  return {
    async insert(user) {
      db.insert(users).values({ id: user.id, name: user.name, createdAt: new Date() }).run();
    },
    async findById(id) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      return row ? { id: row.id, name: row.name } : null;
    },
    async list() {
      return db
        .select()
        .from(users)
        .orderBy(asc(users.createdAt), sql`rowid`)
        .all()
        .map((row) => ({ id: row.id, name: row.name }));
    },
  };
}
