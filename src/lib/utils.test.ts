import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("衝突するクラスを後勝ちにまとめる", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("偽値を無視して結合する", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});
