import { describe, expect, it } from "vitest";
import { createUser } from "./user";

describe("createUser", () => {
  it("非空のnameと一意なidを持つUserを作る", () => {
    const user1 = createUser("たろう");
    const user2 = createUser("たろう");

    expect(user1.name).toBe("たろう");
    expect(user1.id).toBeTruthy();
    expect(user1.id).not.toBe(user2.id);
  });

  it("空文字の名前はエラーにする", () => {
    expect(() => createUser("   ")).toThrow();
  });
});
