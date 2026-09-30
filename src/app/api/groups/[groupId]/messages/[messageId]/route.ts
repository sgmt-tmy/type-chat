import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createMessageRepository } from "@/db/message-repository";
import { createUserRepository } from "@/db/user-repository";
import { DomainError } from "@/errors";
import { handleApi } from "@/server/http";
import { deleteMessageByUser } from "@/server/messages";
import { requireCurrentUser } from "@/server/session";

type Context = { params: Promise<{ groupId: string; messageId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const user = await requireCurrentUser(request, createUserRepository(db));
    const { groupId, messageId } = await context.params;
    try {
      await deleteMessageByUser(
        createGroupRepository(db),
        createMessageRepository(db),
        groupId,
        user.id,
        messageId,
      );
    } catch (error) {
      // グループの存在もメッセージの存在も秘匿するため、404 の文言をそろえる
      if (error instanceof DomainError && error.code === "not_found") {
        throw new DomainError("not_found", "メッセージが見つかりません");
      }
      throw error;
    }
    return new Response(null, { status: 204 });
  });
}
