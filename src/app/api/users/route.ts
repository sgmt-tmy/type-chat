import { getDb } from "@/db/client";
import { createUserRepository } from "@/db/user-repository";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { buildUserCookie } from "@/server/session";
import { listUsers, registerUser } from "@/server/users";

export async function GET(): Promise<Response> {
  return handleApi(async () => {
    const users = await listUsers(createUserRepository(getDb()));
    return jsonResponse({ users: users.map(({ id, name }) => ({ id, name })) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const body = await readJsonBody(request);
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== "string") throw new BadRequestError();
    const user = await registerUser(createUserRepository(getDb()), name);
    return jsonResponse(
      { user: { id: user.id, name: user.name } },
      { status: 201, headers: { "Set-Cookie": buildUserCookie(user.id) } },
    );
  });
}
