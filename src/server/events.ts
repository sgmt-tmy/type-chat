import type { Group } from "../group";
import type { Message } from "../message";

export type LiveEventPayloads = {
  "message.created": { groupId: string; message: Message };
  "message.deleted": { groupId: string; messageId: string };
  "group.updated": { group: Group };
  "group.deleted": { groupId: string };
};

export type LiveEventType = keyof LiveEventPayloads;

export type LiveEvent = {
  [K in LiveEventType]: { type: K; data: LiveEventPayloads[K] };
}[LiveEventType];

export type LiveEventListener = (event: LiveEvent) => void;

export type EventBus = {
  publish(event: LiveEvent, recipientUserIds: readonly string[]): void;
  subscribe(userId: string, listener: LiveEventListener): () => void;
  countSubscribers(userId: string): number;
};

export const LIVE_EVENT_TYPES: readonly LiveEventType[] = [
  "message.created",
  "message.deleted",
  "group.updated",
  "group.deleted",
];
export const SSE_PING = ": ping\n\n";
export const SSE_PING_INTERVAL_MS = 25000;

export function createEventBus(): EventBus {
  const subscribers = new Map<string, Set<{ listener: LiveEventListener }>>();

  return {
    subscribe(userId, listener) {
      const entry = { listener };
      let set = subscribers.get(userId);
      if (!set) {
        set = new Set();
        subscribers.set(userId, set);
      }
      set.add(entry);
      return () => {
        const current = subscribers.get(userId);
        if (!current) return;
        current.delete(entry);
        if (current.size === 0) subscribers.delete(userId);
      };
    },
    publish(event, recipientUserIds) {
      for (const userId of new Set(recipientUserIds)) {
        const set = subscribers.get(userId);
        if (!set) continue;
        for (const { listener } of [...set]) {
          try {
            listener(event);
          } catch (error) {
            console.error(error);
          }
        }
      }
    },
    countSubscribers(userId) {
      return subscribers.get(userId)?.size ?? 0;
    },
  };
}

const BUS_KEY = Symbol.for("type-chat.eventBus");

function getBus(): EventBus {
  const store = globalThis as unknown as Record<symbol, EventBus | undefined>;
  return (store[BUS_KEY] ??= createEventBus());
}

export function publish(event: LiveEvent, recipientUserIds: readonly string[]): void {
  getBus().publish(event, recipientUserIds);
}

export function subscribe(userId: string, listener: LiveEventListener): () => void {
  return getBus().subscribe(userId, listener);
}

export function countSubscribers(userId: string): number {
  return getBus().countSubscribers(userId);
}

/** SSE のイベント1つ分の文字列 */
export function formatSseEvent(event: LiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
