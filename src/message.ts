import { DomainError } from "./errors";
import type { Group } from "./group";

export type Message = {
  id: string;
  groupId: string;
  senderId: string;
  text: string;
  sentAt: Date;
};

export const MESSAGE_MAX_LENGTH = 1000;

export function createMessage(
  groupId: string,
  senderId: string,
  text: string,
  sentAt: Date = new Date(),
): Message {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new DomainError("validation", "メッセージは空にできません");
  }
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError(
      "validation",
      `メッセージは${MESSAGE_MAX_LENGTH}文字以内にしてください`,
    );
  }
  return { id: crypto.randomUUID(), groupId, senderId, text: trimmed, sentAt };
}

export function postMessageToGroup(
  group: Group,
  senderId: string,
  text: string,
  sentAt?: Date,
): Message {
  if (!group.members.includes(senderId)) {
    throw new DomainError("forbidden", "グループのメンバーではありません");
  }
  return createMessage(group.id, senderId, text, sentAt);
}

export function sortMessagesByTime(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}
