import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateGateRules,
  parseInput,
  parseNameStatus,
  parseNumstat,
  parseUnifiedDiffLines,
  runCli,
} from "./check-gate.js";
import { GATE_RULES_PATH } from "./gate-rules.js";

type Rule = Record<string, unknown> & { id: string; check: string };
type Rules = {
  checks: Record<string, { evaluated_by: string[] }>;
  categories: Record<string, { title: string; rules: Rule[] }>;
};
type DiffFile = { path: string; changeType: "added" | "modified" | "deleted" | "renamed"; oldPath?: string };
type Ctx = {
  diff: {
    files: DiffFile[];
    addedLines: Record<string, string[]>;
    removedLines: Record<string, string[]>;
    baseJson: Record<string, unknown>;
    headJson: Record<string, unknown>;
    totalFiles: number;
    totalLines: number;
  };
  specs: { path: string; status?: string }[];
  issueBody: string;
  taskMetadata: { max_attempts: number; [key: string]: unknown };
  failedAttempt: number;
  consecutiveCiFailures: number;
  reviewRuns: number;
};

const CHECKS: Rules["checks"] = {
  changed_paths: { evaluated_by: ["planner", "check-gate"] },
  changed_lines: { evaluated_by: ["planner", "check-gate"] },
  json_keys: { evaluated_by: ["planner", "check-gate"] },
  count: { evaluated_by: ["planner", "check-gate"] },
  spec_link: { evaluated_by: ["planner", "check-gate"] },
  issue_section: { evaluated_by: ["planner", "check-gate"] },
  command: { evaluated_by: ["planner", "pre-tool-use-hook"] },
};

function emptyCtx(): Ctx {
  return {
    diff: { files: [], addedLines: {}, removedLines: {}, baseJson: {}, headJson: {}, totalFiles: 0, totalLines: 0 },
    specs: [],
    issueBody: "",
    taskMetadata: { max_attempts: 3 },
    failedAttempt: 0,
    consecutiveCiFailures: 0,
    reviewRuns: 0,
  };
}

function rulesWith(category: string, rule: Rule): Rules {
  return { checks: CHECKS, categories: { [category]: { title: category, rules: [rule] } } };
}

describe("evaluateGateRules", () => {
  it("irreversible: 削除ファイルがあれば該当し、なければ該当しない", () => {
    const rules = rulesWith("irreversible", {
      id: "irreversible.file-deletion",
      check: "changed_paths",
      paths: ["**"],
      change_types: ["deleted"],
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.files = [{ path: "a.ts", changeType: "deleted" }];
    expect(evaluateGateRules(rules, ctxGate)).toEqual({
      gate: true,
      reasons: [{ category: "irreversible", rule: "irreversible.file-deletion", evidence: "a.ts" }],
    });

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.files = [{ path: "a.ts", changeType: "modified" }];
    expect(evaluateGateRules(rules, ctxNoGate)).toEqual({ gate: false, reasons: [] });
  });

  it("irreversible: リネームは削除として数えない", () => {
    const rules = rulesWith("irreversible", {
      id: "irreversible.file-deletion",
      check: "changed_paths",
      paths: ["**"],
      change_types: ["deleted"],
    });
    const ctx = emptyCtx();
    ctx.diff.files = [{ path: "b.ts", changeType: "renamed", oldPath: "a.ts" }];
    expect(evaluateGateRules(rules, ctx).gate).toBe(false);
  });

  it("spec_ambiguity: 承認済み仕様書と対応が取れていなければ該当する", () => {
    const rules = rulesWith("spec_ambiguity", {
      id: "spec_ambiguity.src-without-approved-spec",
      check: "spec_link",
      paths: ["src/**"],
      spec_paths: ["docs/specs/*.md"],
      allowed_statuses: ["approved", "implemented"],
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.files = [{ path: "src/group.ts", changeType: "modified" }];
    ctxGate.specs = [{ path: "docs/specs/group.md", status: "draft" }];
    ctxGate.issueBody = "docs/specs/group.md と src/group.ts を変更する";
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.files = [{ path: "src/group.ts", changeType: "modified" }];
    ctxNoGate.specs = [{ path: "docs/specs/group.md", status: "approved" }];
    ctxNoGate.issueBody = "docs/specs/group.md と src/group.ts を変更する";
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("spec_ambiguity: 受け入れ条件がチェックボックス形式でなければ該当する", () => {
    const rules = rulesWith("spec_ambiguity", {
      id: "spec_ambiguity.acceptance-not-checkbox",
      check: "issue_section",
      section: "## 受け入れ条件",
      pattern: "^\\s*-\\s\\[[ x]\\]\\s",
      match: "absent",
    });

    const ctxGate = emptyCtx();
    ctxGate.issueBody = "## 受け入れ条件\n- 箇条書きだけ\n## 対象外\n";
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.issueBody = "## 受け入れ条件\n- [ ] チェックボックス\n## 対象外\n";
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);

    // 見出しは「行頭が section で始まる」ものを対象にする（harness-task.md の「## 受け入れ条件（機械判定）」に合わせる）。
    const ctxSuffixHeading = emptyCtx();
    ctxSuffixHeading.issueBody = "## 受け入れ条件（機械判定）\n- [ ] チェックボックス\n## 対象外\n";
    expect(evaluateGateRules(rules, ctxSuffixHeading).gate).toBe(false);
  });

  it("failure_threshold: 試行回数が max_attempts 以上なら該当する（threshold_from）", () => {
    const rules = rulesWith("failure_threshold", {
      id: "failure_threshold.max-attempts",
      check: "count",
      metric: "failed_attempt",
      compare: ">=",
      threshold: 3,
      threshold_from: "max_attempts",
    });

    const ctxGate = emptyCtx();
    ctxGate.taskMetadata = { max_attempts: 2 };
    ctxGate.failedAttempt = 2;
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.taskMetadata = { max_attempts: 5 };
    ctxNoGate.failedAttempt = 2;
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("failure_threshold: CIの連続失敗が閾値以上なら該当する", () => {
    const rules = rulesWith("failure_threshold", {
      id: "failure_threshold.consecutive-ci-failures",
      check: "count",
      metric: "consecutive_ci_failures",
      compare: ">=",
      threshold: 2,
    });

    const ctxGate = emptyCtx();
    ctxGate.consecutiveCiFailures = 2;
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.consecutiveCiFailures = 1;
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("risk_cost: 変更ファイル数が閾値を超えれば該当する", () => {
    const rules = rulesWith("risk_cost", {
      id: "risk_cost.changed-files",
      check: "count",
      metric: "changed_files",
      compare: ">",
      threshold: 8,
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.totalFiles = 9;
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.totalFiles = 8;
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("risk_cost: 閾値を変えると判定が変わる（直書きしていないことの確認）", () => {
    const ctx = emptyCtx();
    ctx.diff.totalFiles = 5;

    const looseRules = rulesWith("risk_cost", {
      id: "risk_cost.changed-files",
      check: "count",
      metric: "changed_files",
      compare: ">",
      threshold: 8,
    });
    expect(evaluateGateRules(looseRules, ctx).gate).toBe(false);

    const strictRules = rulesWith("risk_cost", {
      id: "risk_cost.changed-files",
      check: "count",
      metric: "changed_files",
      compare: ">",
      threshold: 4,
    });
    expect(evaluateGateRules(strictRules, ctx).gate).toBe(true);
  });

  it("risk_cost: docs/specs の変更が2ファイル以上なら該当する（metricにpathsを絞る）", () => {
    const rules = rulesWith("risk_cost", {
      id: "risk_cost.multiple-specs",
      check: "count",
      metric: "changed_files",
      paths: ["docs/specs/*.md"],
      compare: ">=",
      threshold: 2,
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.files = [
      { path: "docs/specs/a.md", changeType: "modified" },
      { path: "docs/specs/b.md", changeType: "modified" },
    ];
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.files = [{ path: "docs/specs/a.md", changeType: "modified" }];
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("security_boundary: 追加行が process.env などを参照すれば該当する", () => {
    const rules = rulesWith("security_boundary", {
      id: "security_boundary.env-and-secret-references",
      check: "changed_lines",
      paths: ["**"],
      lines: "added",
      pattern: "process\\.env",
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.files = [{ path: "src/config.ts", changeType: "modified" }];
    ctxGate.diff.addedLines["src/config.ts"] = ["const token = process.env.API_TOKEN;"];
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.files = [{ path: "src/config.ts", changeType: "modified" }];
    ctxNoGate.diff.addedLines["src/config.ts"] = ["const value = 1;"];
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("security_boundary: package.json の依存の追加・変更に該当する（json_keys, added_or_changed）", () => {
    const rules = rulesWith("security_boundary", {
      id: "security_boundary.settings-permissions-hooks",
      check: "json_keys",
      paths: ["package.json"],
      json_keys: ["dependencies"],
      json_change: "added_or_changed",
    });

    const ctxGate = emptyCtx();
    ctxGate.diff.files = [{ path: "package.json", changeType: "modified" }];
    ctxGate.diff.baseJson["package.json"] = { dependencies: { left: "1.0.0" } };
    ctxGate.diff.headJson["package.json"] = { dependencies: { left: "1.0.0", right: "2.0.0" } };
    expect(evaluateGateRules(rules, ctxGate).gate).toBe(true);

    const ctxNoGate = emptyCtx();
    ctxNoGate.diff.files = [{ path: "package.json", changeType: "modified" }];
    ctxNoGate.diff.baseJson["package.json"] = { dependencies: { left: "1.0.0", right: "2.0.0" } };
    ctxNoGate.diff.headJson["package.json"] = { dependencies: { left: "1.0.0" } };
    expect(evaluateGateRules(rules, ctxNoGate).gate).toBe(false);
  });

  it("check-gate が評価しない check（command）はスキップし、複数区分の該当をまとめて返す", () => {
    const rules: Rules = {
      checks: CHECKS,
      categories: {
        irreversible: {
          title: "irreversible",
          rules: [{ id: "irreversible.repository-settings", check: "command", pattern: "gh api" }],
        },
        risk_cost: {
          title: "risk_cost",
          rules: [
            { id: "risk_cost.changed-files", check: "count", metric: "changed_files", compare: ">", threshold: 0 },
          ],
        },
      },
    };
    const ctx = emptyCtx();
    ctx.diff.totalFiles = 1;

    const result = evaluateGateRules(rules, ctx);
    expect(result.gate).toBe(true);
    expect(result.reasons).toEqual([{ category: "risk_cost", rule: "risk_cost.changed-files", evidence: "changed_files=1 > 0" }]);
  });
});

describe("parseNameStatus", () => {
  it("A/M/D/リネームを解釈する", () => {
    const output = ["A\tnew.ts", "M\tsrc/a.ts", "D\told.ts", "R100\tsrc/b.ts\tsrc/c.ts"].join("\n");
    expect(parseNameStatus(output)).toEqual([
      { path: "new.ts", changeType: "added" },
      { path: "src/a.ts", changeType: "modified" },
      { path: "old.ts", changeType: "deleted" },
      { path: "src/c.ts", changeType: "renamed", oldPath: "src/b.ts" },
    ]);
  });

  it("空行を無視する", () => {
    expect(parseNameStatus("\nM\ta.ts\n\n")).toEqual([{ path: "a.ts", changeType: "modified" }]);
  });
});

describe("parseNumstat", () => {
  it("追加・削除行数を合計し、バイナリ（-）は0として数える", () => {
    expect(parseNumstat("3\t1\ta.ts\n-\t-\timage.png\n")).toEqual({ totalFiles: 2, totalLines: 4 });
  });
});

describe("parseUnifiedDiffLines", () => {
  it("先頭の +/- を除いた行を追加・削除に振り分け、ヘッダー行は無視する", () => {
    const output = [
      "diff --git a/a.ts b/a.ts",
      "index 000..111 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2;",
      " const b = 2;",
    ].join("\n");
    expect(parseUnifiedDiffLines(output)).toEqual({ added: ["const a = 2;"], removed: ["const a = 1;"] });
  });
});

describe("parseInput", () => {
  it("正しい入力はそのまま通り、省略可能な項目は既定値になる", () => {
    const { input, errors } = parseInput({
      taskMetadata: { max_attempts: 3 },
      failedAttempt: 0,
      issueBody: "本文",
    });
    expect(errors).toBeUndefined();
    expect(input).toEqual({
      taskMetadata: { max_attempts: 3 },
      failedAttempt: 0,
      issueBody: "本文",
      consecutiveCiFailures: 0,
      reviewRuns: 0,
    });
  });

  it("taskMetadata.max_attempts が不正ならエラーになる", () => {
    const { errors } = parseInput({ taskMetadata: { max_attempts: 0 }, failedAttempt: 0, issueBody: "" });
    expect(errors).toContain("taskMetadata.max_attempts は1以上の整数にしてください");
  });

  it("failedAttempt が負ならエラーになる", () => {
    const { errors } = parseInput({ taskMetadata: { max_attempts: 1 }, failedAttempt: -1, issueBody: "" });
    expect(errors).toContain("failedAttempt は0以上の整数にしてください");
  });

  it("issueBody が文字列でなければエラーになる", () => {
    const { errors } = parseInput({ taskMetadata: { max_attempts: 1 }, failedAttempt: 0, issueBody: 123 });
    expect(errors).toContain("issueBody は文字列にしてください");
  });

  it("トップレベルがオブジェクトでなければエラーになる", () => {
    expect(parseInput(null).errors).toEqual(["入力JSONのトップレベルはオブジェクトにしてください"]);
  });
});

describe("runCli（一時Gitリポジトリを使った結合テスト）", () => {
  function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "check-gate-"));
    const run = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
    run(["init", "-q", "-b", "main"]);
    run(["config", "user.email", "test@example.com"]);
    run(["config", "user.name", "test"]);

    const gateRulesDir = join(dir, ".claude", "harness");
    mkdirSync(gateRulesDir, { recursive: true });
    writeFileSync(join(gateRulesDir, "gate-rules.json"), readFileSync(GATE_RULES_PATH, "utf-8"));
    writeFileSync(join(dir, "notes.txt"), "hello\n");
    run(["add", "."]);
    run(["commit", "-q", "-m", "base"]);
    return dir;
  }

  const DEFAULT_ISSUE_BODY = "## 受け入れ条件\n- [ ] npm run check が通る\n";

  function writeInput(dir: string, overrides: Record<string, unknown> = {}): string {
    const path = join(dir, "input.json");
    writeFileSync(
      path,
      JSON.stringify({
        taskMetadata: { max_attempts: 3 },
        failedAttempt: 0,
        issueBody: DEFAULT_ISSUE_BODY,
        ...overrides,
      }),
    );
    return path;
  }

  it("gateに該当しない差分なら終了コード0でJSONを出す", () => {
    const dir = makeRepo();
    execFileSync("git", ["checkout", "-q", "-b", "feat/1-x"], { cwd: dir });
    writeFileSync(join(dir, "sandbox.txt"), "no gate here\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "add sandbox file"], { cwd: dir });

    const result = runCli(["--input", writeInput(dir), "--base", "main"], dir);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "{}").gate).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("ファイル削除があれば終了コード2でgate:trueを出す", () => {
    const dir = makeRepo();
    execFileSync("git", ["checkout", "-q", "-b", "feat/2-x"], { cwd: dir });
    rmSync(join(dir, "notes.txt"));
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "delete notes.txt"], { cwd: dir });

    const result = runCli(["--input", writeInput(dir), "--base", "main"], dir);
    expect(result.code).toBe(2);
    const parsed = JSON.parse(result.stdout ?? "{}");
    expect(parsed.gate).toBe(true);
    expect(parsed.reasons.some((r: { rule: string }) => r.rule === "irreversible.file-deletion")).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("--input を指定しないと終了コード1になる", () => {
    const dir = makeRepo();
    const result = runCli([], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--input/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("baseが存在しない参照だと終了コード1になる", () => {
    const dir = makeRepo();
    const result = runCli(["--input", writeInput(dir), "--base", "not-a-ref"], dir);
    expect(result.code).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("基準ファイルの形式が不正だと終了コード1になる", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".claude", "harness", "gate-rules.json"), JSON.stringify({ broken: true }));
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "break rules"], { cwd: dir });
    execFileSync("git", ["checkout", "-q", "-b", "feat/3-x"], { cwd: dir });
    writeFileSync(join(dir, "sandbox.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "add file"], { cwd: dir });

    const result = runCli(["--input", writeInput(dir), "--base", "main"], dir);
    expect(result.code).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });
});
