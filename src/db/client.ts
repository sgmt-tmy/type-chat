import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export const DB_FILE_PATH = "data/type-chat.db";

const MIGRATIONS_FOLDER = "drizzle";

export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(filename: string): Db {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let instance: Db | undefined;

export function getDb(): Db {
  instance ??= createDb(DB_FILE_PATH);
  return instance;
}
