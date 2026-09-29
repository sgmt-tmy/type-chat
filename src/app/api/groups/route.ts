import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { createGroupByUser, listGroupsOfUser } from "@/server/groups";
import { requireCurrentUser } from "@/server/session";

export async function GET(request: Request): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const user = await requireCurrentUser(request, createUserRepository(db));
    const groups = await listGroupsOfUser(createGroupRepository(db), user.id);
    return jsonResponse({ groups });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const user = await requireCurrentUser(request, createUserRepository(db));
    const body = await readJsonBody(request);
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== "string") throw new BadRequestError();
    const group = await createGroupByUser(createGroupRepository(db), user.id, name);
    return jsonResponse(
      { group: { id: group.id, name: group.name, ownerId: group.ownerId, members: group.members } },
      { status: 201 },
    );
  });
}
