import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { addMemberByUser } from "@/server/groups";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { requireCurrentUser } from "@/server/session";

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const body = await readJsonBody(request);
    const memberUserId = (body as { userId?: unknown } | null)?.userId;
    if (typeof memberUserId !== "string") throw new BadRequestError();
    const group = await addMemberByUser(
      createGroupRepository(db),
      users,
      groupId,
      user.id,
      memberUserId,
    );
    return jsonResponse({ group });
  });
}
