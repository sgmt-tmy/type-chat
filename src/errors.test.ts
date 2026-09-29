import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";

describe("DomainError", () => {
  it("ErrorとDomainErrorの両方のインスタンスである", () => {
    const error = new DomainError("validation", "文言");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
  });

  it("code・message・nameを持つ", () => {
    const error = new DomainError("forbidden", "文言");
    expect(error.code).toBe("forbidden");
    expect(error.message).toBe("文言");
    expect(error.name).toBe("DomainError");
  });
});
