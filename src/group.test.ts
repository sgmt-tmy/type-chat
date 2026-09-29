import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  GROUP_NAME_MAX_LENGTH,
  addMember,
  createGroup,
  removeMember,
  renameGroup,
  transferOwner,
} from "./group";

describe("createGroup", () => {
  it("名前とオーナーIDからグループを作る", () => {
    const group = createGroup("開発チーム", "u1");
    expect(group).toEqual({
      id: group.id,
      name: "開発チーム",
      ownerId: "u1",
      members: ["u1"],
    });
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
    expect(updated).toEqual({
      id: group.id,
      name: "新チーム",
      ownerId: "u1",
      members: ["u1"],
    });
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

describe("transferOwner", () => {
  it("オーナーが別のメンバーに委譲すると、ownerIdが更新された新しいGroupが返る", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    const updated = transferOwner(group, "u1", "u2");
    expect(updated.ownerId).toBe("u2");
  });

  it("オーナー以外のメンバーが委譲しようとすると例外が投げられ、元のgroupは変更されない", () => {
    const group = addMember(addMember(createGroup("開発チーム", "u1"), "u2"), "u3");
    expect(() => transferOwner(group, "u2", "u3")).toThrow(
      "オーナー権限の委譲はオーナーのみ可能です",
    );
    expect(group.ownerId).toBe("u1");
  });

  it("グループに属さないユーザーが委譲しようとすると例外が投げられる", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    expect(() => transferOwner(group, "u3", "u2")).toThrow(
      "オーナー権限の委譲はオーナーのみ可能です",
    );
  });

  it("委譲先が現在のオーナー自身の場合は例外が投げられる", () => {
    const group = createGroup("開発チーム", "u1");
    expect(() => transferOwner(group, "u1", "u1")).toThrow(
      "委譲先が現在のオーナーと同じです",
    );
  });

  it("委譲先がグループのメンバーでない場合は例外が投げられる", () => {
    const group = createGroup("開発チーム", "u1");
    expect(() => transferOwner(group, "u1", "u2")).toThrow(
      "委譲先はグループのメンバーである必要があります",
    );
  });

  it("委譲が成功しても、旧オーナーはmembersに残ったままである", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    const updated = transferOwner(group, "u1", "u2");
    expect(updated.members).toContain("u1");
  });

  it("委譲後、nameとmembersは変更前と同じ値のまま保たれる", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    const updated = transferOwner(group, "u1", "u2");
    expect(updated.name).toBe(group.name);
    expect(updated.members).toEqual(group.members);
  });

  it("変更前のgroupオブジェクト自体は変更されない", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    transferOwner(group, "u1", "u2");
    expect(group.ownerId).toBe("u1");
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function expectDomainError(fn: () => unknown, code: string, message: string) {
  const error = catchError(fn);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  expect((error as DomainError).message).toBe(message);
}

describe("Group の ID", () => {
  it("createGroupが返すGroupのidはUUID形式である", () => {
    expect(createGroup("開発チーム", "u1").id).toMatch(UUID_PATTERN);
  });

  it("createGroupを2回呼ぶと異なるidになる", () => {
    expect(createGroup("開発チーム", "u1").id).not.toBe(createGroup("開発チーム", "u1").id);
  });

  it("addMember・removeMember・renameGroup・transferOwnerはidを引き継ぐ", () => {
    const group = addMember(createGroup("開発チーム", "u1"), "u2");
    expect(addMember(group, "u3").id).toBe(group.id);
    expect(removeMember(group, "u2").id).toBe(group.id);
    expect(renameGroup(group, "u1", "新チーム").id).toBe(group.id);
    expect(transferOwner(group, "u1", "u2").id).toBe(group.id);
  });
});

describe("createGroup のグループ名の上限", () => {
  it("50文字ちょうどの名前は作れる", () => {
    const name = "あ".repeat(GROUP_NAME_MAX_LENGTH);
    expect(createGroup(name, "u1").name).toBe(name);
  });

  it("前後の空白を除いて50文字の名前はトリムされて作れる", () => {
    const name = "あ".repeat(GROUP_NAME_MAX_LENGTH);
    expect(createGroup(`  ${name}  `, "u1").name).toBe(name);
  });

  it("51文字の名前はvalidationのDomainErrorになる", () => {
    expectDomainError(
      () => createGroup("あ".repeat(GROUP_NAME_MAX_LENGTH + 1), "u1"),
      "validation",
      "グループ名は50文字以内で入力してください",
    );
  });
});

describe("Group のエラーの種別", () => {
  const base = addMember(createGroup("開発チーム", "u1"), "u2");

  it("createGroup: 空の名前はvalidation", () => {
    expectDomainError(() => createGroup("  ", "u1"), "validation", "グループ名は空にできません");
  });

  it("removeMember: オーナーの削除はconflict", () => {
    expectDomainError(() => removeMember(base, "u1"), "conflict", "オーナーは削除できません");
  });

  it("renameGroup: オーナー以外はforbidden", () => {
    expectDomainError(
      () => renameGroup(base, "u2", "新"),
      "forbidden",
      "グループ名の変更はオーナーのみ可能です",
    );
  });

  it("renameGroup: 空・51文字はvalidation", () => {
    expectDomainError(() => renameGroup(base, "u1", " "), "validation", "グループ名は空にできません");
    expectDomainError(
      () => renameGroup(base, "u1", "あ".repeat(GROUP_NAME_MAX_LENGTH + 1)),
      "validation",
      "グループ名は50文字以内で入力してください",
    );
  });

  it("transferOwner: オーナー以外はforbidden", () => {
    expectDomainError(
      () => transferOwner(base, "u2", "u1"),
      "forbidden",
      "オーナー権限の委譲はオーナーのみ可能です",
    );
  });

  it("transferOwner: 委譲先が現オーナー・非メンバーはvalidation", () => {
    expectDomainError(
      () => transferOwner(base, "u1", "u1"),
      "validation",
      "委譲先が現在のオーナーと同じです",
    );
    expectDomainError(
      () => transferOwner(base, "u1", "u9"),
      "validation",
      "委譲先はグループのメンバーである必要があります",
    );
  });
});
