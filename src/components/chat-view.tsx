"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import type { GroupMemberDetail } from "../server/groups";
import { ChatHeader } from "./chat-header";
import { MESSAGE_INPUT_ID, MessageComposer } from "./message-composer";
import { type ChatMessage, MessageList } from "./message-list";
import { useLiveEvents } from "./use-live-events";

export type ChatViewProps = {
  groupId: string;
  groupName: string;
  currentUserId: string;
  members: Array<GroupMemberDetail>;
};

function sortBySentAt(messages: Array<ChatMessage>): Array<ChatMessage> {
  return messages
    .map((message, index) => ({ message, index }))
    .sort(
      (a, b) => Date.parse(a.message.sentAt) - Date.parse(b.message.sentAt) || a.index - b.index,
    )
    .map(({ message }) => message);
}

export function ChatView({
  groupId,
  groupName,
  currentUserId,
  members,
}: ChatViewProps): React.JSX.Element {
  const [state, setState] = useState<"loading" | "failed" | "loaded">("loading");
  const [messages, setMessages] = useState(() => new Array<ChatMessage>());
  const latestRequest = useRef(0);
  const loaded = useRef(false);

  const request = useCallback((): Promise<void> => {
    const requestId = ++latestRequest.current;
    return apiFetch<{ messages: Array<ChatMessage> }>(`/api/groups/${groupId}/messages`).then(
      (result) => {
        if (requestId !== latestRequest.current) return;
        if (result.ok) {
          loaded.current = true;
          setMessages(result.data.messages);
          setState("loaded");
        } else {
          toast.error(result.error.message);
          if (!loaded.current) setState("failed");
        }
      },
    );
  }, [
    groupId,
  ]);

  useEffect(() => {
    void request();
  }, [
    request,
  ]);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) =>
      current.some((m) => m.id === message.id) ? current : sortBySentAt([...current, message]),
    );
  }, [
  ]);

  useLiveEvents({
    handlers: {
      "message.created": (data) => {
        if (data.groupId !== groupId || state !== "loaded") return;
        const { message } = data;
        const senderName =
          members.find((member) => member.id === message.senderId)?.name ??
          messages.find((m) => m.senderId === message.senderId)?.senderName;
        if (senderName === undefined) {
          void request();
          return;
        }
        addMessage({ ...message, senderName });
      },
    },
    onReconnect: () => void request(),
  });

  return (
    <div>
      <ChatHeader groupId={groupId} groupName={groupName} />
      <MessageList
        state={state}
        messages={messages}
        currentUserId={currentUserId}
        onRetry={() => void request()}
        onStartWriting={() => document.getElementById(MESSAGE_INPUT_ID)?.focus()}
      />
      <MessageComposer groupId={groupId} onSent={addMessage} />
    </div>
  );
}
