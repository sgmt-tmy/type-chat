import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createUserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { findUserToSwitch, listUsers, registerUser } from "./users";

function setup() {
  return createUserRepository(createDb(":memory:"));
}

describe("registerUser", () => {
  it("登録して一覧に載る", async () => {
    const users = setup();
    const u = await registerUser(users, "  たろう ");
    expect(u.name).toBe("たろう");
    expect(await listUsers(users)).toEqual([u]);
  });

  it("同じ名前は conflict で、保存しない", async () => {
    const users = setup();
    await registerUser(users, "たろう");
    await expect(registerUser(users, " たろう ")).rejects.toMatchObject({
      code: "conflict",
      message: "その名前はすでに使われています",
    });
    expect(await listUsers(users)).toHaveLength(1);
  });

  it("大文字・小文字が違う名前は登録できる", async () => {
    const users = setup();
    await registerUser(users, "Taro");
    await registerUser(users, "taro");
    expect(await listUsers(users)).toHaveLength(2);
  });
});

describe("findUserToSwitch", () => {
  it("いなければ not_found", async () => {
    const users = setup();
    const err = await findUserToSwitch(users, crypto.randomUUID()).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: "not_found", message: "利用者が見つかりません" });
  });

  it("いれば返す", async () => {
    const users = setup();
    const u = await registerUser(users, "たろう");
    expect(await findUserToSwitch(users, u.id)).toEqual(u);
  });
});
