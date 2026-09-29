import { DomainError } from "./errors";

export type User = {
  id: string;
  name: string;
};

export const USER_NAME_MAX_LENGTH = 30;

export function createUser(name: string): User {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new DomainError("validation", "ユーザー名は空にできません");
  }
  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    throw new DomainError(
      "validation",
      `ユーザー名は${USER_NAME_MAX_LENGTH}文字以内で入力してください`,
    );
  }
  return { id: crypto.randomUUID(), name: trimmed };
}
