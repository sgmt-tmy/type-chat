import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { leaveGroupByUser } from "@/server/groups";
import { handleApi } from "@/server/http";
import { requireCurrentUser } from "@/server/session";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const user = await requireCurrentUser(request, createUserRepository(db));
    const { groupId } = await context.params;
    await leaveGroupByUser(createGroupRepository(db), groupId, user.id);
    return new Response(null, { status: 204 });
  });
}
