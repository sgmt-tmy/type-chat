"use client";

import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MessageJson } from "./use-live-events";

/** 画面で扱うメッセージ（sentAt は ISO 8601 の文字列） */
export type ChatMessage = MessageJson & { senderName: string };

export type MessageListProps = {
  state: "loading" | "failed" | "loaded";
  messages: Array<ChatMessage>;
  currentUserId: string;
  onRetry: () => void;
  onStartWriting: () => void;
};

/** 最下部から何px以内なら「最下部にいる」とみなすか */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** ISO 8601 の文字列を、ブラウザの地域の時刻で HH:mm にする */
export function formatMessageTime(sentAt: string): string {
  const date = new Date(sentAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function isNearBottom(): boolean {
  return (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - NEAR_BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}

export function MessageList({
  state,
  messages,
  currentUserId,
  onRetry,
  onStartWriting,
}: MessageListProps): React.JSX.Element {
  const atBottom = useRef(true);
  const initialScrolled = useRef(false);
  const knownIds = useRef(new Set<string>());

  useEffect(() => {
    const onScroll = () => {
      atBottom.current = isNearBottom();
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [
  ]);

  useEffect(() => {
    if (state !== "loaded") return;
    const last = messages[messages.length - 1];
    if (!initialScrolled.current) {
      initialScrolled.current = true;
      scrollToBottom();
    } else if (last && !knownIds.current.has(last.id)) {
      if (last.senderId === currentUserId || atBottom.current) scrollToBottom();
    }
    knownIds.current = new Set(messages.map((message) => message.id));
  }, [state, messages, currentUserId]);

  if (state === "loading") {
    return (
      <div aria-busy="true" className="space-y-3 py-4">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className={index % 2 === 0 ? "h-12 w-2/3" : "ml-auto h-12 w-1/2"} />
        ))}
      </div>
    );
  }

  if (state === "failed") {
    return (
      <EmptyState
        title="メッセージを読み込めませんでした"
        description="接続を確認して、もう一度お試しください"
        action={
          <Button type="button" variant="outline" onClick={onRetry}>
            再読み込み
          </Button>
        }
      />
    );
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        title="まだメッセージはありません"
        description="最初のメッセージを送ってみましょう"
        action={
          <Button type="button" variant="outline" onClick={onStartWriting}>
            メッセージを入力する
          </Button>
        }
      />
    );
  }

  return (
    <ol className="space-y-3 py-4">
      {messages.map((message) => {
        const mine = message.senderId === currentUserId;
        return (
          <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`flex max-w-md flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
              {mine ? null : (
                <span className="text-xs text-muted-foreground">{message.senderName}</span>
              )}
              <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                <p
                  className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 ${
                    mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {message.text}
                </p>
                <time dateTime={message.sentAt} className="text-xs text-muted-foreground">
                  {formatMessageTime(message.sentAt)}
                </time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
