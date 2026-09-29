import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createMessageRepository } from "@/db/message-repository";
import { createUserRepository } from "@/db/user-repository";
import { BadRequestError, handleApi, jsonResponse, readJsonBody } from "@/server/http";
import { listMessagesOfGroup, postMessageByUser } from "@/server/messages";
import { requireCurrentUser } from "@/server/session";

type Context = { params: Promise<{ groupId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const messages = await listMessagesOfGroup(
      createGroupRepository(db),
      createMessageRepository(db),
      users,
      groupId,
      user.id,
    );
    return jsonResponse({ messages });
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleApi(async () => {
    const db = getDb();
    const users = createUserRepository(db);
    const user = await requireCurrentUser(request, users);
    const { groupId } = await context.params;
    const body = await readJsonBody(request);
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== "string") throw new BadRequestError();
    const message = await postMessageByUser(
      createGroupRepository(db),
      createMessageRepository(db),
      users,
      groupId,
      user.id,
      text,
    );
    return jsonResponse({ message }, { status: 201 });
  });
}
