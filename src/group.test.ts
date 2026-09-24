import { describe, expect, it } from "vitest";
import { GROUP_NAME_MAX_LENGTH, addMember, createGroup, removeMember, renameGroup } from "./group";

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

describe("removeMember", () => {
  it("一般メンバーをmembersから除外する", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    const updated = removeMember(group, "u2");
    expect(updated.members).toEqual(["u1"]);
  });

  it("ownerIdを指定するとエラーにする", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    expect(() => removeMember(group, "u1")).toThrow("オーナーは削除できません");
    expect(group.members).toEqual(["u1", "u2"]);
  });
});

describe("renameGroup", () => {
  it("オーナーが変更すると名前が更新された新しいGroupが返る", () => {
    const group = createGroup("開発チーム", "u1");
    const updated = renameGroup(group, "u1", "新チーム");
    expect(updated).toEqual({ name: "新チーム", ownerId: "u1", members: ["u1"] });
  });

  it("オーナー以外のメンバーが変更しようとすると例外が投げられ、元のgroupは変更されない", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    expect(() => renameGroup(group, "u2", "新チーム")).toThrow(
      "グループ名の変更はオーナーのみ可能です",
    );
    expect(group.name).toBe("開発チーム");
  });

  it("グループに属さないユーザーが変更しようとすると例外が投げられる", () => {
    const group = createGroup("開発チーム", "u1");
    expect(() => renameGroup(group, "u3", "新チーム")).toThrow(
      "グループ名の変更はオーナーのみ可能です",
    );
  });

  it("空文字（トリム後空文字を含む）を指定すると例外が投げられる", () => {
    const group = createGroup("開発チーム", "u1");
    expect(() => renameGroup(group, "u1", "   ")).toThrow("グループ名は空にできません");
  });

  it("前後に空白を含む名前を指定すると、トリムされた名前が設定される", () => {
    const group = createGroup("開発チーム", "u1");
    const updated = renameGroup(group, "u1", "  新チーム  ");
    expect(updated.name).toBe("新チーム");
  });

  it("GROUP_NAME_MAX_LENGTHちょうどの名前は変更できる", () => {
    const group = createGroup("開発チーム", "u1");
    const name = "あ".repeat(GROUP_NAME_MAX_LENGTH);
    const updated = renameGroup(group, "u1", name);
    expect(updated.name).toBe(name);
  });

  it("GROUP_NAME_MAX_LENGTHを超える名前を指定すると例外が投げられる", () => {
    const group = createGroup("開発チーム", "u1");
    const name = "あ".repeat(GROUP_NAME_MAX_LENGTH + 1);
    expect(() => renameGroup(group, "u1", name)).toThrow(
      `グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`,
    );
  });

  it("変更後、ownerIdとmembersは変更前と同じ値のまま保たれる", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    const updated = renameGroup(group, "u1", "新チーム");
    expect(updated.ownerId).toBe(group.ownerId);
    expect(updated.members).toEqual(group.members);
  });

  it("変更前のgroupオブジェクト自体は変更されない", () => {
    const group = createGroup("開発チーム", "u1");
    renameGroup(group, "u1", "新チーム");
    expect(group.name).toBe("開発チーム");
  });
});
