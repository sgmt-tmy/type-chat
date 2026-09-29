import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { getGroupDetail } from "@/server/groups";
import { handleApi, jsonResponse } from "@/server/http";
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
