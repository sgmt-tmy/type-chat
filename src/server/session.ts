import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { createUserRepository, type UserRepository } from "../db/user-repository";
import type { User } from "../user";
import { UnauthenticatedError } from "./http";

export const USER_COOKIE_NAME = "type_chat_user_id";
export const USER_COOKIE_MAX_AGE = 31536000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCookieValue(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === USER_COOKIE_NAME) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

async function findUser(
  value: string | null | undefined,
  users: UserRepository,
): Promise<User | null> {
  if (!value || !UUID_PATTERN.test(value)) return null;
  return users.findById(value);
}

/** Request の Cookie ヘッダーから現在の利用者を読む。いなければ null */
export async function getCurrentUser(
  request: Request,
  users: UserRepository,
): Promise<User | null> {
  return findUser(readCookieValue(request.headers.get("cookie")), users);
}

/** getCurrentUser と同じ。いなければ UnauthenticatedError を投げる（API で 401 になる） */
export async function requireCurrentUser(
  request: Request,
  users: UserRepository,
): Promise<User> {
  const user = await getCurrentUser(request, users);
  if (!user) throw new UnauthenticatedError();
  return user;
}

/** Server Component から現在の利用者を読む。いなければ null */
export async function getCurrentUserInPage(): Promise<User | null> {
  const store = await cookies();
  return findUser(store.get(USER_COOKIE_NAME)?.value, createUserRepository(getDb()));
}

/** getCurrentUserInPage と同じ。いなければ /start へリダイレクトする */
export async function requireCurrentUserInPage(): Promise<User> {
  const user = await getCurrentUserInPage();
  if (!user) redirect("/start");
  return user;
}

/** Cookie を設定する Set-Cookie ヘッダーの値 */
export function buildUserCookie(userId: string): string {
  return `${USER_COOKIE_NAME}=${userId}; Max-Age=${USER_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Cookie を削除する Set-Cookie ヘッダーの値 */
export function buildClearUserCookie(): string {
  return `${USER_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}
