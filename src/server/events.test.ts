import { describe, expect, it, vi } from "vitest";
import { createEventBus, formatSseEvent, LIVE_EVENT_TYPES, type LiveEvent } from "./events";

const event: LiveEvent = { type: "group.deleted", data: { groupId: "g1" } };

function messageEvent(text: string, sentAt: Date): LiveEvent {
  return {
    type: "message.created",
    data: { groupId: "g1", message: { id: "m1", groupId: "g1", senderId: "u1", text, sentAt } },
  };
}

describe("createEventBus", () => {
  it("届け先の購読者にだけ届く", () => {
    const bus = createEventBus();
    const a = vi.fn();
    bus.subscribe("A", a);
    bus.publish(event, ["B"]);
    expect(a).not.toHaveBeenCalled();
    bus.publish(event, ["A"]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(event);
  });

  it("解除後は届かない。解除は2回呼んでもほかの購読を解除しない", () => {
    const bus = createEventBus();
    const l1 = vi.fn();
    const l2 = vi.fn();
    const un1 = bus.subscribe("A", l1);
    bus.subscribe("A", l2);
    expect(bus.countSubscribers("A")).toBe(2);
    un1();
    un1();
    expect(bus.countSubscribers("A")).toBe(1);
    bus.publish(event, ["A"]);
    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it("同じ利用者の複数の購読すべてに1回ずつ届き、IDの重複は1回にまとめる", () => {
    const bus = createEventBus();
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.subscribe("A", l1);
    bus.subscribe("A", l2);
    bus.publish(event, ["A", "A"]);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it("届け先が空でも例外にならない", () => {
    const bus = createEventBus();
    const l = vi.fn();
    bus.subscribe("A", l);
    expect(() => bus.publish(event, [])).not.toThrow();
    expect(l).not.toHaveBeenCalled();
  });

  it("例外を投げるリスナーがあっても、ほかのリスナーへ配信する", () => {
    const bus = createEventBus();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = vi.fn();
    bus.subscribe("A", () => {
      throw new Error("boom");
    });
    bus.subscribe("A", ok);
    expect(() => bus.publish(event, ["A"])).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("2つのイベントバスは独立している", () => {
    const b1 = createEventBus();
    const b2 = createEventBus();
    const l = vi.fn();
    b2.subscribe("A", l);
    b1.publish(event, ["A"]);
    expect(l).not.toHaveBeenCalled();
  });
});

describe("globalThis のイベントバス", () => {
  it("モジュールを読み込み直しても同じバスを使う", async () => {
    const first = await import("./events");
    const l = vi.fn();
    const un = first.subscribe("A", l);
    vi.resetModules();
    const second = await import("./events");
    expect(second).not.toBe(first);
    second.publish(event, ["A"]);
    expect(l).toHaveBeenCalledTimes(1);
    expect(second.countSubscribers("A")).toBe(1);
    un();
    expect(second.countSubscribers("A")).toBe(0);
  });
});

describe("LIVE_EVENT_TYPES", () => {
  it("4種類だけ", () => {
    expect([...LIVE_EVENT_TYPES].sort()).toEqual([
      "group.deleted",
      "group.updated",
      "message.created",
      "message.deleted",
    ]);
  });
});

describe("formatSseEvent", () => {
  it("event 行と data 行の形式", () => {
    expect(formatSseEvent(event)).toBe('event: group.deleted\ndata: {"groupId":"g1"}\n\n');
  });

  it("sentAt は ISO 8601 の文字列になる", () => {
    const text = formatSseEvent(messageEvent("hi", new Date("2026-09-28T12:34:56.789Z")));
    const data = JSON.parse(text.split("\n")[1].slice("data: ".length));
    expect(data.message.sentAt).toBe("2026-09-28T12:34:56.789Z");
  });

  it("本文に改行があっても data 行は1行", () => {
    const text = formatSseEvent(messageEvent("a\nb\r\nc", new Date()));
    expect(text.split("\n").filter((l) => l.startsWith("data:"))).toHaveLength(1);
  });
});
