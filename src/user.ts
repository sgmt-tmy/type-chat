export type User = {
  id: string;
  name: string;
};

export function createUser(name: string): User {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("ユーザー名は空にできません");
  }
  return { id: crypto.randomUUID(), name: trimmed };
}
