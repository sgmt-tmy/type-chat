import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globToRegExp, loadGateRules, matchesAnyGlob, validateGateRules } from "./gate-rules.js";
import { GATE_REASONS } from "./metadata.js";

type Rule = {
  id: string;
  check: string;
  paths?: string[];
  pattern?: string;
  threshold?: number;
  [key: string]: unknown;
};
type GateRules = {
  categories: Record<string, { title: string; rules: Rule[] }>;
  [key: string]: unknown;
};

const settingsPath = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));

function loadRealRules(): GateRules {
  const result = loadGateRules();
  expect(result.errors).toBeUndefined();
  return result.rules as GateRules;
}

function allRules(rules: GateRules): Rule[] {
  return Object.values(rules.categories).flatMap((category) => category.rules);
}

function ruleById(id: string): Rule {
  const rule = allRules(loadRealRules()).find((candidate) => candidate.id === id);
  if (!rule) {
    throw new Error(`ルールが見つかりません: ${id}`);
  }
  return rule;
}

function patternOf(id: string): RegExp {
  return new RegExp(ruleById(id).pattern ?? "");
}

describe("基準ファイル（.claude/harness/gate-rules.json）", () => {
  it("形式の検証でエラーにならない", () => {
    expect(loadGateRules().errors).toBeUndefined();
  });

  it("5区分それぞれに見出しとルールが1つ以上ある", () => {
    const rules = loadRealRules();

    expect(Object.keys(rules.categories).sort()).toEqual([...GATE_REASONS].sort());
    for (const category of GATE_REASONS) {
      expect(rules.categories[category].title).not.toBe("");
      expect(rules.categories[category].rules.length).toBeGreaterThan(0);
    }
  });

  it("すべてのルールが paths / threshold / pattern のいずれかを持つ", () => {
    for (const rule of allRules(loadRealRules())) {
      const hasCriterion = rule.paths !== undefined || rule.threshold !== undefined || rule.pattern !== undefined;
      expect(hasCriterion, rule.id).toBe(true);
    }
  });
});

describe("禁止事項との重複", () => {
  const forbiddenCommands = [
    // .claude/settings.json の deny（Bash）を元にした例
    ...(JSON.parse(readFileSync(settingsPath, "utf-8")).permissions.deny as string[])
      .filter((entry) => entry.startsWith("Bash("))
      .map((entry) => entry.replace(/^Bash\(/, "").replace(/(:\*)?\)$/, "")),
    // CLAUDE.md の「やってはいけないこと」だけにある操作
    "gh repo edit --visibility public",
    "gh repo edit sgmt-tmy/type-chat --visibility private --accept-visibility-change-consequences",
    "gh api -X DELETE repos/sgmt-tmy/type-chat/git/refs/heads/feat/x",
    "git push origin --delete feat/x",
    "git branch -D feat/x",
  ];
  const forbiddenFiles = [".env", ".env.local", "config/.env.production", "certs/server.pem", "certs/server.key"];

  it("command ルールが禁止されたコマンドに当たらない", () => {
    const commandRules = allRules(loadRealRules()).filter((rule) => rule.check === "command");
    expect(forbiddenCommands.length).toBeGreaterThan(5);

    for (const rule of commandRules) {
      const pattern = new RegExp(rule.pattern ?? "");
      for (const command of forbiddenCommands) {
        expect(pattern.test(command), `${rule.id}: ${command}`).toBe(false);
      }
    }
  });

  it("paths で .env や鍵ファイルそのものを指定したルールがない（作る・コミットするのは禁止のため）", () => {
    for (const rule of allRules(loadRealRules())) {
      const specificGlobs = (rule.paths ?? []).filter((glob) => glob !== "**");
      for (const file of forbiddenFiles) {
        expect(matchesAnyGlob(file, specificGlobs), `${rule.id}: ${file}`).toBe(false);
      }
    }
  });
});

describe("各ルールの pattern / paths", () => {
  it("リポジトリ設定を変えるコマンドに当たり、読み取りや禁止事項には当たらない", () => {
    const pattern = patternOf("irreversible.repository-settings");

    expect(pattern.test("gh api -X PUT repos/sgmt-tmy/type-chat/rulesets/123 --input ruleset.json")).toBe(true);
    expect(pattern.test("gh api --method=DELETE repos/o/r/branches/main/protection")).toBe(true);
    expect(pattern.test("gh repo edit --enable-issues=false")).toBe(true);
    expect(pattern.test("gh secret set API_TOKEN")).toBe(true);
    expect(pattern.test("gh variable delete FOO")).toBe(true);
    expect(pattern.test("gh api repos/sgmt-tmy/type-chat/rulesets")).toBe(false);
    expect(pattern.test("gh repo edit --visibility public")).toBe(false);
  });

  it(".env・process.env・secrets の参照に当たり、無関係な語には当たらない", () => {
    const pattern = patternOf("security_boundary.env-and-secret-references");

    expect(pattern.test('const token = process.env.API_TOKEN;')).toBe(true);
    expect(pattern.test('readFileSync(".env.local")')).toBe(true);
    expect(pattern.test("- `.env` を読まない")).toBe(true);
    expect(pattern.test("token: ${{ secrets.GITHUB_TOKEN }}")).toBe(true);
    expect(pattern.test("const environment = 'test';")).toBe(false);
    expect(pattern.test("Never commit secrets.")).toBe(false);
  });

  it("鍵ファイルの参照に当たり、obj.key のようなコードには当たらない", () => {
    const pattern = patternOf("security_boundary.key-file-references");

    expect(pattern.test('readFileSync("certs/server.key")')).toBe(true);
    expect(pattern.test("cat ~/.ssh/id_ed25519")).toBe(true);
    expect(pattern.test("cert: server.pem")).toBe(true);
    expect(pattern.test("if (event.key === 'Enter') {")).toBe(false);
    expect(pattern.test("const value = map.key;")).toBe(false);
  });

  it("ワークフローの permissions の行に当たり、ほかの行には当たらない", () => {
    const pattern = patternOf("security_boundary.workflow-permissions");

    expect(pattern.test("permissions:")).toBe(true);
    expect(pattern.test("  permissions: write-all")).toBe(true);
    expect(pattern.test("      contents: write")).toBe(true);
    expect(pattern.test("      id-token: none")).toBe(true);
    expect(pattern.test("    runs-on: ubuntu-latest")).toBe(false);
    expect(pattern.test("      - run: npm run check")).toBe(false);
  });

  it("エージェントの tools 行に当たる", () => {
    const pattern = patternOf("security_boundary.agent-tools");

    expect(pattern.test("tools: Read, Grep, Glob, Bash")).toBe(true);
    expect(pattern.test("description: tools を使う")).toBe(false);
  });

  it("受け入れ条件のチェックボックスに当たる", () => {
    const pattern = patternOf("spec_ambiguity.acceptance-not-checkbox");

    expect(pattern.test("- [ ] `npm run check` が通る")).toBe(true);
    expect(pattern.test("- [x] 基準ファイルが存在する")).toBe(true);
    expect(pattern.test("- 基準ファイルが存在する")).toBe(false);
  });

  it("認証・ユーザー関連のパスに当たり、ほかの src には当たらない", () => {
    const paths = ruleById("security_boundary.auth-user-code").paths ?? [];

    expect(matchesAnyGlob("src/user.ts", paths)).toBe(true);
    expect(matchesAnyGlob("src/user.test.ts", paths)).toBe(true);
    expect(matchesAnyGlob("src/auth/login.ts", paths)).toBe(true);
    expect(matchesAnyGlob("src/sessionStore.ts", paths)).toBe(true);
    expect(matchesAnyGlob("src/group.ts", paths)).toBe(false);
    expect(matchesAnyGlob("src/message.ts", paths)).toBe(false);
  });

  it("ガードレール自体（基準・判定スクリプト・CLAUDE.md・フック）のパスに当たる", () => {
    const paths = ruleById("security_boundary.guardrails").paths ?? [];

    expect(matchesAnyGlob(".claude/harness/gate-rules.json", paths)).toBe(true);
    expect(matchesAnyGlob(".claude/harness/conventions.md", paths)).toBe(true);
    expect(matchesAnyGlob("scripts/harness/check-gate.js", paths)).toBe(true);
    expect(matchesAnyGlob("CLAUDE.md", paths)).toBe(true);
    expect(matchesAnyGlob(".claude/hooks/lint-edited-file.js", paths)).toBe(true);
    expect(matchesAnyGlob("docs/CLAUDE.md", paths)).toBe(false);
    expect(matchesAnyGlob("scripts/check-specs.js", paths)).toBe(false);
  });

  it("仕様書の対応は src のテスト以外を対象にする", () => {
    const rule = ruleById("spec_ambiguity.src-without-approved-spec");
    const isTarget = (path: string) =>
      matchesAnyGlob(path, rule.paths ?? []) && !matchesAnyGlob(path, rule.exclude_paths as string[]);

    expect(isTarget("src/group.ts")).toBe(true);
    expect(isTarget("src/group.test.ts")).toBe(false);
    expect(isTarget("scripts/check-specs.js")).toBe(false);
  });
});

describe("globToRegExp", () => {
  it("* は / をまたがず、** はまたぐ", () => {
    expect(globToRegExp("docs/specs/*.md").test("docs/specs/group-rename.md")).toBe(true);
    expect(globToRegExp("docs/specs/*.md").test("docs/specs/old/group-rename.md")).toBe(false);
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("**").test("a/b/c.ts")).toBe(true);
  });

  it("**/ は0個以上のディレクトリに一致する", () => {
    expect(globToRegExp("src/**/*.test.ts").test("src/user.test.ts")).toBe(true);
    expect(globToRegExp("src/**/*.test.ts").test("src/a/b/user.test.ts")).toBe(true);
    expect(globToRegExp("src/**/*.test.ts").test("src/user.ts")).toBe(false);
  });

  it("ドットファイルにも一致し、. はそのままの文字として扱う", () => {
    expect(globToRegExp(".claude/*.json").test(".claude/settings.json")).toBe(true);
    expect(globToRegExp("package.json").test("packageXjson")).toBe(false);
  });
});

describe("validateGateRules", () => {
  function validRules(): GateRules {
    return structuredClone(loadRealRules());
  }

  it("区分が欠けているとエラーになる", () => {
    const rules = validRules();
    delete rules.categories.risk_cost;

    expect(validateGateRules(rules)).toContain("categories.risk_cost がありません");
  });

  it("ルールが1つもない区分はエラーになる", () => {
    const rules = validRules();
    rules.categories.failure_threshold.rules = [];

    expect(validateGateRules(rules)).toContain("categories.failure_threshold にルールが1つもありません");
  });

  it("未知の区分はエラーになる", () => {
    const rules = validRules();
    rules.categories.forbidden = { title: "禁止", rules: [] };

    expect(validateGateRules(rules).some((error: string) => error.includes("未知の区分"))).toBe(true);
  });

  it("paths / threshold / pattern のどれも持たないルールはエラーになる", () => {
    const rules = validRules();
    const rule = rules.categories.irreversible.rules[0];
    delete rule.paths;

    expect(validateGateRules(rules)).toContain(
      `irreversible.rules[${rule.id}]: paths / threshold / pattern のいずれかが必要です`,
    );
  });

  it("human_check や rationale がないとエラーになる", () => {
    const rules = validRules();
    const rule = rules.categories.risk_cost.rules[0];
    rule.human_check = [];
    delete rule.rationale;

    const errors = validateGateRules(rules);
    expect(errors.some((error: string) => error.includes("human_check"))).toBe(true);
    expect(errors).toContain(`risk_cost.rules[${rule.id}]: rationale がありません`);
  });

  it("不正な正規表現・未定義の metric・不正な compare はエラーになる", () => {
    const rules = validRules();
    rules.categories.security_boundary.rules[0].pattern = "(unclosed";
    const countRule = rules.categories.risk_cost.rules[0];
    countRule.metric = "unknown_metric";
    countRule.compare = "<";

    const errors = validateGateRules(rules);
    expect(errors.some((error: string) => error.includes("正規表現として不正"))).toBe(true);
    expect(errors.some((error: string) => error.includes("metric が不正"))).toBe(true);
    expect(errors.some((error: string) => error.includes("compare が不正"))).toBe(true);
  });

  it("check に必要なフィールドがないとエラーになる", () => {
    const rules = validRules();
    const rule = rules.categories.security_boundary.rules[0];
    delete rule.lines;

    expect(validateGateRules(rules)).toContain(
      `security_boundary.rules[${rule.id}]: check が changed_lines のときは lines が必要です`,
    );
  });

  it("id の重複と、区分と合わない id はエラーになる", () => {
    const rules = validRules();
    const [first, second] = rules.categories.irreversible.rules;
    second.id = first.id;
    rules.categories.risk_cost.rules[0].id = "irreversible.misplaced";

    const errors = validateGateRules(rules);
    expect(errors).toContain(`ルールの id が重複しています（${first.id}）`);
    expect(errors.some((error: string) => error.includes("「risk_cost.」で始まる"))).toBe(true);
  });
});

describe("loadGateRules", () => {
  it("JSONとして読めないファイルはエラーを返す", () => {
    const path = join(mkdtempSync(join(tmpdir(), "gate-rules-")), "broken.json");
    writeFileSync(path, "{ broken");

    const result = loadGateRules(path);
    expect(result.rules).toBeUndefined();
    expect(result.errors?.[0]).toMatch(/^基準ファイルを読み込めません/);
  });
});
