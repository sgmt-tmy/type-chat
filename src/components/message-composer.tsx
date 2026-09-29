"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import { MESSAGE_MAX_LENGTH } from "../message";
import type { ChatMessage } from "./message-list";

export const MESSAGE_INPUT_ID = "message-input";

/** 残り文字数を出し始める文字数 */
export const MESSAGE_COUNTER_THRESHOLD = 900;

const HINT_ID = "message-input-hint";

export type MessageComposerProps = {
  groupId: string;
  onSent: (message: ChatMessage) => void;
};

export function MessageComposer({ groupId, onSent }: MessageComposerProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const length = text.trim().length;
  const tooLong = length > MESSAGE_MAX_LENGTH;
  const canSend = length > 0 && !tooLong && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setApiError(null);
    const result = await apiFetch<{ message: ChatMessage }>(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text },
    });
    setSending(false);
    if (result.ok) {
      onSent(result.data.message);
      setText("");
      inputRef.current?.focus();
    } else if (result.error.code === "validation") {
      setApiError(result.error.message);
    } else {
      toast.error(result.error.message);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  let hint: React.JSX.Element | null = null;
  if (apiError) {
    hint = (
      <p id={HINT_ID} className="text-sm text-destructive">
        {apiError}
      </p>
    );
  } else if (tooLong) {
    hint = (
      <p id={HINT_ID} className="text-sm text-destructive">
        {length - MESSAGE_MAX_LENGTH}文字オーバーしています
      </p>
    );
  } else if (length > MESSAGE_COUNTER_THRESHOLD) {
    hint = (
      <p id={HINT_ID} className="text-sm text-muted-foreground">
        残り {MESSAGE_MAX_LENGTH - length}文字
      </p>
    );
  }
  const invalid = apiError !== null || tooLong;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="sticky bottom-0 space-y-2 bg-background py-3"
    >
      <Label htmlFor={MESSAGE_INPUT_ID} className="sr-only">
        メッセージ
      </Label>
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          id={MESSAGE_INPUT_ID}
          value={text}
          placeholder="メッセージを入力"
          onChange={(event) => {
            setText(event.target.value);
            setApiError(null);
          }}
          onKeyDown={handleKeyDown}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? HINT_ID : undefined}
        />
        <Button type="submit" variant="default" disabled={!canSend}>
          {sending ? "送信中…" : "送信"}
        </Button>
      </div>
      {hint}
    </form>
  );
}
