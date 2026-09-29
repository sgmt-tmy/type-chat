import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveEvents, type UseLiveEventsOptions } from "./use-live-events";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Set<(e: Event) => void>>();
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, l: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (e: Event) => void) {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string, data?: string) {
    const e = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const l of this.listeners.get(type) ?? []) l(e);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

const TYPES = ["message.created", "message.deleted", "group.updated", "group.deleted"] as const;

describe("useLiveEvents", () => {
  it("/api/events で1回だけ接続する", () => {
    renderHook(() => useLiveEvents({ handlers: {} }));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events");
  });

  it.each(TYPES)("%s は該当のハンドラだけを JSON.parse した値で呼ぶ", (type) => {
    const handlers = {
      "message.created": vi.fn(),
      "message.deleted": vi.fn(),
      "group.updated": vi.fn(),
      "group.deleted": vi.fn(),
    };
    renderHook(() => useLiveEvents({ handlers }));
    FakeEventSource.instances[0].emit(type, JSON.stringify({ x: 1 }));
    for (const t of TYPES) {
      expect(handlers[t]).toHaveBeenCalledTimes(t === type ? 1 : 0);
    }
    expect(handlers[type]).toHaveBeenCalledWith({ x: 1 });
  });

  it("sentAt は文字列のまま", () => {
    const h = vi.fn();
    renderHook(() => useLiveEvents({ handlers: { "message.created": h } }));
    FakeEventSource.instances[0].emit(
      "message.created",
      JSON.stringify({ groupId: "g", message: { sentAt: "2026-09-28T12:34:56.789Z" } }),
    );
    expect(h.mock.calls[0][0].message.sentAt).toBe("2026-09-28T12:34:56.789Z");
  });

  it("ハンドラがなくても例外にならない", () => {
    renderHook(() => useLiveEvents({ handlers: {} }));
    expect(() => FakeEventSource.instances[0].emit("group.deleted", "{}")).not.toThrow();
  });

  it("JSON でない data はハンドラを呼ばず、例外にならない", () => {
    const h = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useLiveEvents({ handlers: { "group.deleted": h } }));
    expect(() => FakeEventSource.instances[0].emit("group.deleted", "not json")).not.toThrow();
    expect(h).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("2回目以降の open で onReconnect を呼ぶ", () => {
    const onReconnect = vi.fn();
    renderHook(() => useLiveEvents({ handlers: {}, onReconnect }));
    const es = FakeEventSource.instances[0];
    es.emit("open");
    expect(onReconnect).not.toHaveBeenCalled();
    es.emit("error");
    es.emit("open");
    expect(onReconnect).toHaveBeenCalledTimes(1);
    es.emit("error");
    es.emit("open");
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("再描画で接続を張り直さず、新しいハンドラが呼ばれる", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const { rerender } = renderHook((o: UseLiveEventsOptions) => useLiveEvents(o), {
      initialProps: { handlers: { "group.deleted": h1 } },
    });
    rerender({ handlers: { "group.deleted": h2 } });
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].emit("group.deleted", "{}");
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("アンマウントで close する", () => {
    const { unmount } = renderHook(() => useLiveEvents({ handlers: {} }));
    unmount();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
  });

  it("ソースに setInterval と setTimeout がない", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "use-live-events.ts"), "utf8");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});
