import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { transferOwnerByUser } from "@/server/groups";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { requireCurrentUser } from "@/server/session";

export async function PUT(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const body = await readJsonBody(request);
    const newOwnerId = (body as { userId?: unknown } | null)?.userId;
    if (typeof newOwnerId !== "string") throw new BadRequestError();
    const group = await transferOwnerByUser(
      createGroupRepository(db),
      users,
      groupId,
      user.id,
      newOwnerId,
    );
    return jsonResponse({ group });
  });
}
