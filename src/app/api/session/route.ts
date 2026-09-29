import { getDb } from "@/db/client";
import { createUserRepository } from "@/db/user-repository";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { buildClearUserCookie, buildUserCookie } from "@/server/session";
import { findUserToSwitch } from "@/server/users";

export async function PUT(request: Request): Promise<Response> {
  return handleApi(async () => {
    const body = await readJsonBody(request);
    const userId = (body as { userId?: unknown } | null)?.userId;
    if (typeof userId !== "string") throw new BadRequestError();
    const user = await findUserToSwitch(createUserRepository(getDb()), userId);
    return jsonResponse(
      { user: { id: user.id, name: user.name } },
      { headers: { "Set-Cookie": buildUserCookie(user.id) } },
    );
  });
}

export async function DELETE(): Promise<Response> {
  return handleApi(async () => {
    return new Response(null, { status: 204, headers: { "Set-Cookie": buildClearUserCookie() } });
  });
}
