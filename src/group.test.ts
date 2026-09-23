import { describe, expect, it } from "vitest";
import { createGroup } from "./group";

describe("createGroup", () => {
  it("名前とオーナーIDからグループを作る", () => {
    const group = createGroup("開発チーム", "u1");
    expect(group).toEqual({ name: "開発チーム", ownerId: "u1" });
  });

  it("空文字の名前はエラーにする", () => {
    expect(() => createGroup("   ", "u1")).toThrow();
  });
});
