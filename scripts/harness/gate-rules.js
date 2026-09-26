// gate の判定基準ファイル（.claude/harness/gate-rules.json）を読み込み、形式を検証する。
// 書式の意味は基準ファイル自体の checks / metrics / glob_syntax を参照。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GATE_REASONS } from "./metadata.js";

export const GATE_RULES_PATH = fileURLToPath(new URL("../../.claude/harness/gate-rules.json", import.meta.url));

/** check の種類ごとの必須フィールド。 */
export const CHECK_REQUIRED_FIELDS = {
  changed_paths: ["paths"],
  changed_lines: ["paths", "lines", "pattern"],
  json_keys: ["paths", "json_keys", "json_change"],
  count: ["metric", "compare", "threshold"],
  spec_link: ["paths", "spec_paths", "allowed_statuses"],
  issue_section: ["section", "pattern", "match"],
  command: ["pattern"],
};
export const CHANGE_TYPES = ["added", "modified", "deleted", "renamed"];
export const LINE_KINDS = ["added", "removed", "changed"];
export const JSON_CHANGES = ["any", "added_or_changed"];
export const COMPARES = [">", ">="];
export const THRESHOLD_FROM = ["max_attempts"];
export const ISSUE_SECTION_MATCHES = ["absent"];

/**
 * glob（基準ファイルの glob_syntax に従う）を正規表現にする。
 * * は / 以外の0文字以上、** は / を含む0文字以上、**\/ は0個以上のディレクトリ、? は / 以外の1文字。
 */
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** パスが glob のどれかに一致するか。 */
export function matchesAnyGlob(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function checkRegExp(value, label, errors) {
  try {
    new RegExp(value);
  } catch {
    errors.push(`${label}: pattern が正規表現として不正です（${value}）`);
  }
}

function validateRule(rule, category, metricNames, errors) {
  const label = `${category}.rules[${rule?.id ?? "?"}]`;
  if (typeof rule !== "object" || rule === null) {
    errors.push(`${label}: ルールはオブジェクトにしてください`);
    return;
  }

  if (!isNonEmptyString(rule.id) || !rule.id.startsWith(`${category}.`)) {
    errors.push(`${label}: id は「${category}.」で始まる文字列にしてください`);
  }
  for (const key of ["summary", "rationale"]) {
    if (!isNonEmptyString(rule[key])) {
      errors.push(`${label}: ${key} がありません`);
    }
  }
  if (!isNonEmptyStringArray(rule.human_check)) {
    errors.push(`${label}: human_check（gateで止まったときに人が確認すること）を1つ以上書いてください`);
  }

  if (!("paths" in rule) && !("threshold" in rule) && !("pattern" in rule)) {
    errors.push(`${label}: paths / threshold / pattern のいずれかが必要です`);
  }

  const required = CHECK_REQUIRED_FIELDS[rule.check];
  if (!required) {
    errors.push(`${label}: check が不正です（${rule.check}）。${Object.keys(CHECK_REQUIRED_FIELDS).join(" / ")} のいずれかにしてください`);
    return;
  }
  for (const key of required) {
    if (!(key in rule)) {
      errors.push(`${label}: check が ${rule.check} のときは ${key} が必要です`);
    }
  }

  for (const key of ["paths", "exclude_paths", "spec_paths", "json_keys", "allowed_statuses"]) {
    if (key in rule && !isNonEmptyStringArray(rule[key])) {
      errors.push(`${label}: ${key} は空でない文字列の配列にしてください`);
    }
  }
  if ("pattern" in rule) {
    if (isNonEmptyString(rule.pattern)) {
      checkRegExp(rule.pattern, label, errors);
    } else {
      errors.push(`${label}: pattern は空でない文字列にしてください`);
    }
  }
  if ("threshold" in rule && !(typeof rule.threshold === "number" && Number.isInteger(rule.threshold) && rule.threshold >= 0)) {
    errors.push(`${label}: threshold は0以上の整数にしてください`);
  }

  const enumFields = [
    ["change_types", CHANGE_TYPES, true],
    ["lines", LINE_KINDS, false],
    ["json_change", JSON_CHANGES, false],
    ["compare", COMPARES, false],
    ["threshold_from", THRESHOLD_FROM, false],
    ["match", ISSUE_SECTION_MATCHES, false],
    ["metric", metricNames, false],
  ];
  for (const [key, allowed, isList] of enumFields) {
    if (!(key in rule)) {
      continue;
    }
    const values = isList ? rule[key] : [rule[key]];
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => !allowed.includes(value))) {
      errors.push(`${label}: ${key} が不正です（${JSON.stringify(rule[key])}）。${allowed.join(" / ")} から選んでください`);
    }
  }
}

/**
 * パース済みの基準ファイルを検証する。
 * 戻り値はエラーメッセージの配列（問題がなければ空）。
 */
export function validateGateRules(rules) {
  const errors = [];
  if (typeof rules !== "object" || rules === null) {
    return ["基準ファイルのトップレベルはオブジェクトにしてください"];
  }

  if (!isNonEmptyStringArray(rules.forbidden?.references)) {
    errors.push("forbidden.references に禁止事項の参照先を書いてください");
  }
  if (typeof rules.checks !== "object" || rules.checks === null) {
    errors.push("checks がありません");
  } else {
    for (const check of Object.keys(CHECK_REQUIRED_FIELDS)) {
      if (!isNonEmptyString(rules.checks[check]?.description)) {
        errors.push(`checks.${check}.description がありません`);
      }
    }
  }
  const metricNames = typeof rules.metrics === "object" && rules.metrics !== null ? Object.keys(rules.metrics) : [];

  const categories = rules.categories;
  if (typeof categories !== "object" || categories === null) {
    errors.push("categories がありません");
    return errors;
  }
  for (const key of Object.keys(categories)) {
    if (!GATE_REASONS.includes(key)) {
      errors.push(`categories に未知の区分があります（${key}）。${GATE_REASONS.join(" / ")} のいずれかにしてください`);
    }
  }

  const seenIds = new Set();
  for (const category of GATE_REASONS) {
    const entry = categories[category];
    if (!entry) {
      errors.push(`categories.${category} がありません`);
      continue;
    }
    if (!isNonEmptyString(entry.title)) {
      errors.push(`categories.${category}.title がありません`);
    }
    if (!Array.isArray(entry.rules) || entry.rules.length === 0) {
      errors.push(`categories.${category} にルールが1つもありません`);
      continue;
    }
    for (const rule of entry.rules) {
      validateRule(rule, category, metricNames, errors);
      if (seenIds.has(rule?.id)) {
        errors.push(`ルールの id が重複しています（${rule.id}）`);
      }
      seenIds.add(rule?.id);
    }
  }

  return errors;
}

/** 基準ファイルを読み込んで検証する。成功時は { rules }、失敗時は { errors } を返す。 */
export function loadGateRules(path = GATE_RULES_PATH) {
  let rules;
  try {
    rules = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return { errors: [`基準ファイルを読み込めません（${error instanceof Error ? error.message : String(error)}）`] };
  }
  const errors = validateGateRules(rules);
  return errors.length > 0 ? { errors } : { rules };
}
