import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { createUser } from "./user";

describe("createUser", () => {
  it("非空のnameと一意なidを持つUserを作る", () => {
    const user1 = createUser("たろう");
    const user2 = createUser("たろう");

    expect(user1.name).toBe("たろう");
    expect(user1.id).toBeTruthy();
    expect(user1.id).not.toBe(user2.id);
  });

  it("空文字の名前は validation の DomainError にする", () => {
    expect(() => createUser("   ")).toThrow(DomainError);
    expect(() => createUser("   ")).toThrow("ユーザー名は空にできません");
    try {
      createUser("");
    } catch (e) {
      expect((e as DomainError).code).toBe("validation");
    }
  });

  it("30文字ちょうどは作れる", () => {
    const name = "あ".repeat(30);
    expect(createUser(name).name).toBe(name);
  });

  it("前後の空白を除いて30文字なら、トリムした名前で作れる", () => {
    const name = "あ".repeat(30);
    expect(createUser(`  ${name}  `).name).toBe(name);
  });

  it("31文字は validation の DomainError にする", () => {
    try {
      createUser("あ".repeat(31));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("validation");
      expect((e as DomainError).message).toBe("ユーザー名は30文字以内で入力してください");
    }
  });
});
