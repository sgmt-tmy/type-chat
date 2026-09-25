import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATE_REASONS, parseHarnessMetadata, REQUIRED_KEYS } from "./metadata.js";

const templatePath = fileURLToPath(
  new URL("../../.github/ISSUE_TEMPLATE/harness-task.md", import.meta.url),
);

function bodyWith(blockLines: string[]): string {
  return ["## 背景・目的", "", "## ハーネスメタデータ", "```yaml", ...blockLines, "```", "", "## 依存", "なし"].join("\n");
}

const validBlock = [
  "id: T9",
  "depends_on: [#45, #47, #48]",
  "gate: true",
  "gate_reasons: [spec_ambiguity, security_boundary]",
  "risk: medium",
  "max_attempts: 3",
];

describe("parseHarnessMetadata", () => {
  it("ハーネスタスク用Issueテンプレートの本文をパースできる", () => {
    const template = readFileSync(templatePath, "utf-8");
    const result = parseHarnessMetadata(template);

    expect(result.errors).toBeUndefined();
    expect(result.metadata).toEqual({
      id: "T0",
      depends_on: [],
      gate: false,
      gate_reasons: [],
      risk: "low",
      max_attempts: 3,
    });
  });

  it("必須キー6つを型付きの値として取り出す", () => {
    const result = parseHarnessMetadata(bodyWith(validBlock));

    expect(result.errors).toBeUndefined();
    expect(result.metadata).toEqual({
      id: "T9",
      depends_on: [45, 47, 48],
      gate: true,
      gate_reasons: ["spec_ambiguity", "security_boundary"],
      risk: "medium",
      max_attempts: 3,
    });
  });

  it("CRLFの本文もパースできる", () => {
    const result = parseHarnessMetadata(bodyWith(validBlock).replace(/\n/g, "\r\n"));

    expect(result.errors).toBeUndefined();
    expect(result.metadata?.id).toBe("T9");
  });

  it.each(REQUIRED_KEYS)("必須キー %s の欠落を検出する", (key) => {
    const block = validBlock.filter((line) => !line.startsWith(`${key}:`));
    const result = parseHarnessMetadata(bodyWith(block));

    expect(result.metadata).toBeUndefined();
    expect(result.errors).toContain(`必須キーがありません（${key}）`);
  });

  it("メタデータの見出しが無ければエラー", () => {
    const result = parseHarnessMetadata("## 背景・目的\n本文\n");

    expect(result.errors).toEqual(["「## ハーネスメタデータ」セクションに ```yaml ブロックがありません"]);
  });

  it("見出しの次のセクションにあるyamlブロックは読まない", () => {
    const body = ["## ハーネスメタデータ", "なし", "", "## 別の見出し", "```yaml", ...validBlock, "```"].join("\n");

    expect(parseHarnessMetadata(body).errors).toEqual([
      "「## ハーネスメタデータ」セクションに ```yaml ブロックがありません",
    ]);
  });

  it.each(GATE_REASONS)("gate_reasons に区分 %s を使える", (reason) => {
    const block = validBlock.map((line) => (line.startsWith("gate_reasons:") ? `gate_reasons: [${reason}]` : line));
    const result = parseHarnessMetadata(bodyWith(block));

    expect(result.metadata?.gate_reasons).toEqual([reason]);
  });

  it("gate_reasons に5区分以外の値があればエラー", () => {
    const block = validBlock.map((line) =>
      line.startsWith("gate_reasons:") ? "gate_reasons: [spec_ambiguity, cost]" : line,
    );
    const result = parseHarnessMetadata(bodyWith(block));

    expect(result.metadata).toBeUndefined();
    expect(result.errors).toEqual([
      "gate_reasons に不正な区分があります（cost）。irreversible / spec_ambiguity / failure_threshold / risk_cost / security_boundary のいずれかにしてください",
    ]);
  });

  it("gate: true で gate_reasons が空ならエラー", () => {
    const block = validBlock.map((line) => (line.startsWith("gate_reasons:") ? "gate_reasons: []" : line));

    expect(parseHarnessMetadata(bodyWith(block)).errors).toEqual([
      "gate: true のときは gate_reasons を1つ以上書いてください",
    ]);
  });

  it("gate: false で gate_reasons があればエラー", () => {
    const block = validBlock.map((line) => (line.startsWith("gate:") ? "gate: false" : line));

    expect(parseHarnessMetadata(bodyWith(block)).errors).toEqual([
      "gate: false のときは gate_reasons を空（[]）にしてください",
    ]);
  });

  it.each([
    ["id: 9", "id の形式が不正です（9）。T<数字> にしてください"],
    ["depends_on: #45", "depends_on は [#番号, ...] の形式にしてください（#45）"],
    ["depends_on: [45]", "depends_on の要素は #<Issue番号> にしてください（45）"],
    ["gate: yes", "gate は true / false のいずれかにしてください（yes）"],
    ["risk: critical", "risk の値が不正です（critical）。low / medium / high のいずれかにしてください"],
    ["max_attempts: 0", "max_attempts は1以上の整数にしてください（0）"],
  ])("値が不正ならエラー: %s", (replacement, expected) => {
    const key = replacement.split(":")[0];
    const block = validBlock.map((line) => (line.startsWith(`${key}:`) ? replacement : line));

    expect(parseHarnessMetadata(bodyWith(block)).errors).toEqual([expected]);
  });

  it("未知のキー・重複したキー・形式外の行はエラー", () => {
    const result = parseHarnessMetadata(bodyWith([...validBlock, "role: implementer", "risk: low", "- item"]));

    expect(result.errors).toEqual([
      "未知のキーです（role）",
      "キーが重複しています（risk）",
      "key: value の形式ではない行があります（- item）",
    ]);
  });
});
