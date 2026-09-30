import type { GroupRepository } from "../db/group-repository";
import type { MessageRepository } from "../db/message-repository";
import type { UserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { assertCanDeleteMessage, postMessageToGroup, type Message } from "../message";
import { publish } from "./events";
import { findGroupAsMember, UNKNOWN_MEMBER_NAME } from "./groups";

/** 投稿者の名前を含むメッセージ */
export type MessageWithSender = Message & { senderName: string };

export async function listMessagesOfGroup(
  groups: GroupRepository,
  messages: MessageRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
): Promise<MessageWithSender[]> {
  await findGroupAsMember(groups, groupId, userId);
  const list = await messages.listByGroup(groupId);
  const names = new Map<string, string>();
  for (const m of list) {
    if (names.has(m.senderId)) continue;
    const user = await users.findById(m.senderId);
    names.set(m.senderId, user?.name ?? UNKNOWN_MEMBER_NAME);
  }
  return list.map((m) => ({ ...m, senderName: names.get(m.senderId) ?? UNKNOWN_MEMBER_NAME }));
}

export async function postMessageByUser(
  groups: GroupRepository,
  messages: MessageRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  text: string,
): Promise<MessageWithSender> {
  const group = await findGroupAsMember(groups, groupId, userId);
  const message = postMessageToGroup(group, userId, text);
  await messages.insert(message);
  publish({ type: "message.created", data: { groupId: group.id, message } }, group.members);
  const sender = await users.findById(userId);
  return { ...message, senderName: sender?.name ?? UNKNOWN_MEMBER_NAME };
}

export async function deleteMessageByUser(
  groups: GroupRepository,
  messages: MessageRepository,
  groupId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  const group = await findGroupAsMember(groups, groupId, userId);
  const message = await messages.findById(messageId);
  if (message === null || message.groupId !== group.id) {
    throw new DomainError("not_found", "メッセージが見つかりません");
  }
  assertCanDeleteMessage(message, userId);
  await messages.delete(messageId);
  publish({ type: "message.deleted", data: { groupId: group.id, messageId } }, group.members);
}
