"use client";

import { useEffect, useRef } from "react";
import type { Message } from "../message";
import type { LiveEventPayloads, LiveEventType } from "../server/events";

/** JSON で受け取った Message（sentAt は ISO 8601 の文字列） */
export type MessageJson = Omit<Message, "sentAt"> & { sentAt: string };

export type LiveEventJsonPayloads = {
  "message.created": { groupId: string; message: MessageJson };
  "message.deleted": LiveEventPayloads["message.deleted"];
  "group.updated": LiveEventPayloads["group.updated"];
  "group.deleted": LiveEventPayloads["group.deleted"];
};

export type LiveEventHandlers = {
  [K in LiveEventType]?: (data: LiveEventJsonPayloads[K]) => void;
};

export type UseLiveEventsOptions = {
  handlers: LiveEventHandlers;
  onReconnect?: () => void;
};

const EVENT_TYPES: readonly LiveEventType[] = [
  "message.created",
  "message.deleted",
  "group.updated",
  "group.deleted",
];

export function useLiveEvents(options: UseLiveEventsOptions): void {
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const source = new EventSource("/api/events");
    let opened = false;

    const onOpen = () => {
      if (opened) latest.current.onReconnect?.();
      opened = true;
    };
    source.addEventListener("open", onOpen);

    const listeners = EVENT_TYPES.map((type) => {
      const listener = (e: Event) => {
        const handler = latest.current.handlers[type] as ((data: unknown) => void) | undefined;
        if (!handler) return;
        let data: unknown;
        try {
          data = JSON.parse((e as MessageEvent<string>).data);
        } catch (error) {
          console.error(error);
          return;
        }
        handler(data);
      };
      source.addEventListener(type, listener);
      return [type, listener] as const;
    });

    return () => {
      source.removeEventListener("open", onOpen);
      for (const [type, listener] of listeners) source.removeEventListener(type, listener);
      source.close();
    };
  }, []);
}
