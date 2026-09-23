import { describe, expect, it } from "vitest";
import { addMember, createGroup } from "./group";

describe("createGroup", () => {
  it("名前とオーナーIDからグループを作る", () => {
    const group = createGroup("開発チーム", "u1");
    expect(group).toEqual({ name: "開発チーム", ownerId: "u1", members: ["u1"] });
  });

  it("空文字の名前はエラーにする", () => {
    expect(() => createGroup("   ", "u1")).toThrow();
  });
});

describe("addMember", () => {
  it("メンバーを追加する", () => {
    const group = createGroup("開発チーム", "u1");
    const updated = addMember(group, "u2");
    expect(updated.members).toEqual(["u1", "u2"]);
  });

  it("同じuserIdを2回追加してもmembersが重複しない", () => {
    const group = createGroup("開発チーム", "u1");
    const once = addMember(group, "u2");
    const twice = addMember(once, "u2");
    expect(twice.members).toEqual(["u1", "u2"]);
  });
});
