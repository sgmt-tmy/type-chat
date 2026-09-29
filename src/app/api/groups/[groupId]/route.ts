import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { getGroupDetail, renameGroupByUser } from "@/server/groups";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { requireCurrentUser } from "@/server/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const group = await getGroupDetail(createGroupRepository(db), users, groupId, user.id);
    return jsonResponse({ group });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const body = await readJsonBody(request);
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== "string") throw new BadRequestError();
    const group = await renameGroupByUser(createGroupRepository(db), users, groupId, user.id, name);
    return jsonResponse({ group });
  });
}
