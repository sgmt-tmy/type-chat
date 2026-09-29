import type { UserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { createUser, type User } from "../user";

export async function listUsers(users: UserRepository): Promise<User[]> {
  return users.list();
}

export async function registerUser(users: UserRepository, name: string): Promise<User> {
  const user = createUser(name);
  const existing = await users.list();
  if (existing.some((u) => u.name === user.name)) {
    throw new DomainError("conflict", "その名前はすでに使われています");
  }
  await users.insert(user);
  return user;
}

export async function findUserToSwitch(users: UserRepository, userId: string): Promise<User> {
  const user = await users.findById(userId);
  if (!user) throw new DomainError("not_found", "利用者が見つかりません");
  return user;
}
