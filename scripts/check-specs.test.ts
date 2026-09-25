import { describe, expect, it } from "vitest";
import {
  checkSpecFile,
  isAcceptanceCriteriaAllChecked,
  listSpecFiles,
  parseFrontmatter,
  SPECS_DIR,
} from "./check-specs.js";

describe("parseFrontmatter", () => {
  it("frontmatterのkey: valueを取り出す", () => {
    const content = "---\nstatus: draft\nupdated: 2026-09-25\n---\n# タイトル\n";
    const result = parseFrontmatter(content);

    expect(result.error).toBeUndefined();
    expect(result.fields).toEqual({ status: "draft", updated: "2026-09-25" });
  });

  it("1行目が --- でない場合はエラーを返す", () => {
    const result = parseFrontmatter("# タイトル\nstatus: draft\n");

    expect(result.error).toBe("1行目が --- ではありません");
  });

  it("閉じる --- が無い場合はエラーを返す", () => {
    const result = parseFrontmatter("---\nstatus: draft\n# タイトル\n");

    expect(result.error).toBe("frontmatterを閉じる --- が見つかりません");
  });

  it("値の末尾のコメントを無視する", () => {
    const content = "---\nstatus: draft        # draft / approved / implemented / deprecated\n---\n";
    const result = parseFrontmatter(content);

    expect(result.fields?.status).toBe("draft");
  });
});

describe("isAcceptanceCriteriaAllChecked", () => {
  it("受け入れ条件が1つ以上あり全て [x] ならtrue", () => {
    const bodyLines = ["## 受け入れ条件", "- [x] 条件1", "- [x] 条件2", "", "## 対象外"];

    expect(isAcceptanceCriteriaAllChecked(bodyLines)).toBe(true);
  });

  it("未チェックの項目があればfalse", () => {
    const bodyLines = ["## 受け入れ条件", "- [x] 条件1", "- [ ] 条件2"];

    expect(isAcceptanceCriteriaAllChecked(bodyLines)).toBe(false);
  });

  it("チェックボックスが無ければfalse", () => {
    const bodyLines = ["## 受け入れ条件", "（テストケースに落とせる粒度で書く）"];

    expect(isAcceptanceCriteriaAllChecked(bodyLines)).toBe(false);
  });

  it("受け入れ条件セクション以外のチェックボックスは無視する", () => {
    const bodyLines = ["## 受け入れ条件", "- [x] 条件1", "## 対象外", "- [ ] 対象外の項目"];

    expect(isAcceptanceCriteriaAllChecked(bodyLines)).toBe(true);
  });
});

describe("checkSpecFile", () => {
  it("正しいframontmatterならerrors/warningsとも空", () => {
    const content = "---\nstatus: draft\nupdated: 2026-09-25\n---\n# タイトル\n\n## 受け入れ条件\n- [ ] 条件1\n";
    const { errors, warnings } = checkSpecFile("ok.md", content);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("1行目が --- でなければエラー", () => {
    const { errors } = checkSpecFile("bad.md", "# タイトル\n");

    expect(errors).toEqual(["bad.md: 1行目が --- ではありません"]);
  });

  it("statusが不正な値ならエラー", () => {
    const content = "---\nstatus: unknown\nupdated: 2026-09-25\n---\n";
    const { errors } = checkSpecFile("bad-status.md", content);

    expect(errors).toEqual([
      "bad-status.md: status の値が不正です（unknown）。draft / approved / implemented / deprecated のいずれかにしてください",
    ]);
  });

  it("statusが無ければエラー", () => {
    const content = "---\nupdated: 2026-09-25\n---\n";
    const { errors } = checkSpecFile("no-status.md", content);

    expect(errors).toEqual(["no-status.md: frontmatterに status がありません"]);
  });

  it("updatedがYYYY-MM-DD形式でなければエラー", () => {
    const content = "---\nstatus: draft\nupdated: 2026/09/25\n---\n";
    const { errors } = checkSpecFile("bad-date.md", content);

    expect(errors).toEqual([
      "bad-date.md: updated の形式が不正です（2026/09/25）。YYYY-MM-DD形式にしてください",
    ]);
  });

  it("updatedが無ければエラー", () => {
    const content = "---\nstatus: draft\n---\n";
    const { errors } = checkSpecFile("no-date.md", content);

    expect(errors).toEqual(["no-date.md: frontmatterに updated がありません"]);
  });

  it("approvedで受け入れ条件が全て[x]なら警告のみでエラーにはならない", () => {
    const content =
      "---\nstatus: approved\nupdated: 2026-09-25\n---\n# タイトル\n\n## 受け入れ条件\n- [x] 条件1\n";
    const { errors, warnings } = checkSpecFile("approved-done.md", content);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "approved-done.md: 受け入れ条件がすべて [x] ですが status が approved のままです（実装済みへの更新漏れの可能性）",
    ]);
  });

  it("implementedで受け入れ条件が全て[x]でも警告なし", () => {
    const content =
      "---\nstatus: implemented\nupdated: 2026-09-25\n---\n# タイトル\n\n## 受け入れ条件\n- [x] 条件1\n";
    const { warnings } = checkSpecFile("implemented-done.md", content);

    expect(warnings).toEqual([]);
  });
});

describe("listSpecFiles", () => {
  it("_template.md を除いた.mdファイル一覧を返す", () => {
    const files = listSpecFiles(SPECS_DIR);

    expect(files).not.toContain("_template.md");
    expect(files.every((name) => name.endsWith(".md"))).toBe(true);
  });
});
