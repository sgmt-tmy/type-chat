export type Message = {
  groupId: string;
  text: string;
  sentAt: Date;
};

export function createMessage(
  groupId: string,
  text: string,
  sentAt: Date = new Date(),
): Message {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("メッセージは空にできません");
  }
  return { groupId, text: trimmed, sentAt };
}