export type Message = {
  groupId: string;
  text: string;
  sentAt: Date;
};

export const MESSAGE_MAX_LENGTH = 1000;

export function createMessage(
  groupId: string,
  text: string,
  sentAt: Date = new Date(),
): Message {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("メッセージは空にできません");
  }
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`メッセージは${MESSAGE_MAX_LENGTH}文字以内にしてください`);
  }
  return { groupId, text: trimmed, sentAt };
}

export function sortMessagesByTime(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}