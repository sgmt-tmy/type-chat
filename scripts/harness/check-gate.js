// 差分・タスクメタデータ・試行回数から gate の要否を判定する。
// 判定ルールは .claude/harness/gate-rules.json（比較元コミットの内容）から読み込み、直書きしない。
// 使い方: node scripts/harness/check-gate.js --input <入力JSONのパス> [--base origin/main]
// 入力JSONの形式は README コメント（parseInput）を参照。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matchesAnyGlob, validateGateRules } from "./gate-rules.js";
import { parseFrontmatter } from "../check-specs.js";

const GATE_RULES_REPO_PATH = ".claude/harness/gate-rules.json";

/** パスが glob 配列（paths）に一致し、exclude_paths に一致しないか。 */
function matchesPathFilter(path, rule) {
  if (!matchesAnyGlob(path, rule.paths)) {
    return false;
  }
  return !(rule.exclude_paths && matchesAnyGlob(path, rule.exclude_paths));
}

function evalChangedPaths(rule, ctx) {
  const matchedFiles = [];
  for (const file of ctx.diff.files) {
    if (rule.change_types && !rule.change_types.includes(file.changeType)) {
      continue;
    }
    const candidates = file.changeType === "renamed" ? [file.oldPath, file.path] : [file.path];
    if (candidates.some((path) => matchesPathFilter(path, rule))) {
      matchedFiles.push(file.path);
    }
  }
  return { matched: matchedFiles.length > 0, evidence: matchedFiles.join(", ") };
}

function evalChangedLines(rule, ctx) {
  const pattern = new RegExp(rule.pattern);
  const evidence = [];
  for (const file of ctx.diff.files) {
    if (!matchesPathFilter(file.path, rule)) {
      continue;
    }
    const lines = [];
    if (rule.lines === "added" || rule.lines === "changed") {
      lines.push(...(ctx.diff.addedLines[file.path] ?? []));
    }
    if (rule.lines === "removed" || rule.lines === "changed") {
      lines.push(...(ctx.diff.removedLines[file.path] ?? []));
    }
    const hit = lines.find((line) => pattern.test(line));
    if (hit !== undefined) {
      evidence.push(`${file.path}: ${hit}`);
    }
  }
  return { matched: evidence.length > 0, evidence: evidence.join(" / ") };
}

function evalJsonKeys(rule, ctx) {
  const evidence = [];
  for (const file of ctx.diff.files) {
    if (!matchesPathFilter(file.path, rule)) {
      continue;
    }
    const base = ctx.diff.baseJson[file.path] ?? {};
    const head = ctx.diff.headJson[file.path] ?? {};
    for (const key of rule.json_keys) {
      if (rule.json_change === "any") {
        if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
          evidence.push(`${file.path}:${key}`);
        }
        continue;
      }
      const baseEntries = base[key] && typeof base[key] === "object" ? base[key] : {};
      const headEntries = head[key] && typeof head[key] === "object" ? head[key] : {};
      for (const entryKey of Object.keys(headEntries)) {
        if (JSON.stringify(baseEntries[entryKey]) !== JSON.stringify(headEntries[entryKey])) {
          evidence.push(`${file.path}:${key}.${entryKey}`);
        }
      }
    }
  }
  return { matched: evidence.length > 0, evidence: evidence.join(", ") };
}

function computeMetric(rule, ctx) {
  switch (rule.metric) {
    case "changed_files":
      return rule.paths
        ? ctx.diff.files.filter((file) => matchesPathFilter(file.path, rule)).length
        : ctx.diff.totalFiles;
    case "changed_lines":
      return ctx.diff.totalLines;
    case "failed_attempt":
      return ctx.failedAttempt;
    case "consecutive_ci_failures":
      return ctx.consecutiveCiFailures;
    case "review_runs":
      return ctx.reviewRuns;
    default:
      throw new Error(`未対応のmetricです（${rule.metric}）`);
  }
}

function evalCount(rule, ctx) {
  const value = computeMetric(rule, ctx);
  const threshold = rule.threshold_from ? ctx.taskMetadata[rule.threshold_from] : rule.threshold;
  const matched = rule.compare === ">" ? value > threshold : value >= threshold;
  return { matched, evidence: `${rule.metric}=${value} ${rule.compare} ${threshold}` };
}

function evalSpecLink(rule, ctx) {
  const violations = [];
  for (const file of ctx.diff.files) {
    if (!matchesPathFilter(file.path, rule)) {
      continue;
    }
    const satisfied = ctx.specs.some(
      (spec) =>
        matchesAnyGlob(spec.path, rule.spec_paths) &&
        rule.allowed_statuses.includes(spec.status) &&
        ctx.issueBody.includes(spec.path) &&
        ctx.issueBody.includes(file.path),
    );
    if (!satisfied) {
      violations.push(file.path);
    }
  }
  return { matched: violations.length > 0, evidence: violations.join(", ") };
}

/** 行頭が heading で始まる見出しのセクション（次の同じレベル以上の見出しまで）の行を取り出す。見つからなければ空配列。 */
function extractSection(body, heading) {
  const lines = body.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().startsWith(heading));
  if (headingIndex === -1) {
    return [];
  }
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const rest = lines.slice(headingIndex + 1);
  const nextHeadingOffset = rest.findIndex((line) => new RegExp(`^#{1,${level}}\\s`).test(line));
  return nextHeadingOffset === -1 ? rest : rest.slice(0, nextHeadingOffset);
}

function evalIssueSection(rule, ctx) {
  const lines = extractSection(ctx.issueBody, rule.section);
  const pattern = new RegExp(rule.pattern);
  const hasMatch = lines.some((line) => pattern.test(line));
  // match: "absent" のみ対応（セクション自体がない場合も「一致する行がない」に含む）。
  const matched = !hasMatch;
  return { matched, evidence: matched ? `「${rule.section}」に一致する行がありません` : "" };
}

const CHECK_EVALUATORS = {
  changed_paths: evalChangedPaths,
  changed_lines: evalChangedLines,
  json_keys: evalJsonKeys,
  count: evalCount,
  spec_link: evalSpecLink,
  issue_section: evalIssueSection,
};

/**
 * 検証済みの基準ファイル（rules）と差分・メタデータ等のコンテキスト（ctx）から、gateの要否を判定する。
 * ctx の形式:
 * {
 *   diff: {
 *     files: [{ path, changeType: "added"|"modified"|"deleted"|"renamed", oldPath? }],
 *     addedLines: { [path]: string[] }, removedLines: { [path]: string[] },
 *     baseJson: { [path]: unknown }, headJson: { [path]: unknown },
 *     totalFiles: number, totalLines: number,
 *   },
 *   specs: [{ path, status }],
 *   issueBody: string,
 *   taskMetadata: { gate, gate_reasons, risk, max_attempts, ... },
 *   failedAttempt: number, consecutiveCiFailures: number, reviewRuns: number,
 * }
 * 戻り値: { gate: boolean, reasons: [{ category, rule, evidence }] }
 */
export function evaluateGateRules(rules, ctx) {
  const reasons = [];
  for (const [category, categoryDef] of Object.entries(rules.categories)) {
    for (const rule of categoryDef.rules) {
      const checkDef = rules.checks[rule.check];
      if (!checkDef.evaluated_by.includes("check-gate")) {
        continue;
      }
      const evaluator = CHECK_EVALUATORS[rule.check];
      if (!evaluator) {
        throw new Error(`未対応のcheckです（${rule.check}）`);
      }
      const { matched, evidence } = evaluator(rule, ctx);
      if (matched) {
        reasons.push({ category, rule: rule.id, evidence });
      }
    }
  }
  return { gate: reasons.length > 0, reasons };
}

// ---- ここから CLI（git・ファイルシステムを使う部分） ----

/** `git diff --name-status -M` の出力を { path, changeType, oldPath? } の配列にする。 */
export function parseNameStatus(output) {
  const files = [];
  for (const line of output.split("\n").filter((l) => l.trim() !== "")) {
    const columns = line.split("\t");
    const [status, first, second] = columns;
    if (status.startsWith("R")) {
      files.push({ path: second, changeType: "renamed", oldPath: first });
    } else if (status === "A") {
      files.push({ path: first, changeType: "added" });
    } else if (status === "D") {
      files.push({ path: first, changeType: "deleted" });
    } else {
      files.push({ path: first, changeType: "modified" });
    }
  }
  return files;
}

/** `git diff --numstat` の出力から合計ファイル数・合計行数を出す（バイナリは0行）。 */
export function parseNumstat(output) {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  let totalLines = 0;
  for (const line of lines) {
    const [added, removed] = line.split("\t");
    totalLines += (added === "-" ? 0 : Number(added)) + (removed === "-" ? 0 : Number(removed));
  }
  return { totalFiles: lines.length, totalLines };
}

/** 1ファイル分の unified diff から追加行・削除行の内容（先頭の +/- を除く）を取り出す。 */
export function parseUnifiedDiffLines(output) {
  const added = [];
  const removed = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      added.push(line.slice(1));
    } else if (line.startsWith("-")) {
      removed.push(line.slice(1));
    }
  }
  return { added, removed };
}

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** CLI入力JSONを検証する。成功時は { input }、失敗時は { errors }。 */
export function parseInput(raw) {
  const errors = [];
  if (typeof raw !== "object" || raw === null) {
    return { errors: ["入力JSONのトップレベルはオブジェクトにしてください"] };
  }
  if (typeof raw.taskMetadata !== "object" || raw.taskMetadata === null || !isPositiveInteger(raw.taskMetadata.max_attempts)) {
    errors.push("taskMetadata.max_attempts は1以上の整数にしてください");
  }
  if (!isNonNegativeInteger(raw.failedAttempt)) {
    errors.push("failedAttempt は0以上の整数にしてください");
  }
  if (typeof raw.issueBody !== "string") {
    errors.push("issueBody は文字列にしてください");
  }
  for (const key of ["consecutiveCiFailures", "reviewRuns"]) {
    if (key in raw && !isNonNegativeInteger(raw[key])) {
      errors.push(`${key} は0以上の整数にしてください`);
    }
  }
  if (errors.length > 0) {
    return { errors };
  }
  return {
    input: {
      taskMetadata: raw.taskMetadata,
      failedAttempt: raw.failedAttempt,
      issueBody: raw.issueBody,
      consecutiveCiFailures: raw.consecutiveCiFailures ?? 0,
      reviewRuns: raw.reviewRuns ?? 0,
    },
  };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** git show <ref>:<path> の内容を返す。存在しなければ undefined。 */
function tryShow(ref, path, cwd) {
  try {
    return git(["show", `${ref}:${path}`], cwd);
  } catch {
    return undefined;
  }
}

function tryParseJson(content) {
  if (content === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** 比較元（mergeBase）とHEADの差分から、evaluateGateRules に渡す diff を組み立てる。 */
function buildDiff(mergeBase, cwd) {
  const files = parseNameStatus(git(["diff", "--name-status", "-M", mergeBase, "HEAD"], cwd));
  const { totalFiles, totalLines } = parseNumstat(git(["diff", "--numstat", "-M", mergeBase, "HEAD"], cwd));

  const addedLines = {};
  const removedLines = {};
  const baseJson = {};
  const headJson = {};
  for (const file of files) {
    const pathspecs = file.oldPath ? [file.oldPath, file.path] : [file.path];
    const fileDiff = git(["diff", "-M", mergeBase, "HEAD", "--", ...pathspecs], cwd);
    const { added, removed } = parseUnifiedDiffLines(fileDiff);
    addedLines[file.path] = added;
    removedLines[file.path] = removed;

    if (file.path.endsWith(".json")) {
      baseJson[file.path] = tryParseJson(tryShow(mergeBase, file.oldPath ?? file.path, cwd));
      headJson[file.path] = tryParseJson(tryShow("HEAD", file.path, cwd));
    }
  }

  return { files, addedLines, removedLines, baseJson, headJson, totalFiles, totalLines };
}

/** rules の spec_link ルールが参照する spec_paths に一致するファイルを、mergeBase 時点の内容とともに集める。 */
function buildSpecs(rules, mergeBase, cwd) {
  const specPathGlobs = Object.values(rules.categories)
    .flatMap((category) => category.rules)
    .filter((rule) => rule.check === "spec_link")
    .flatMap((rule) => rule.spec_paths);
  if (specPathGlobs.length === 0) {
    return [];
  }

  const allPaths = git(["ls-tree", "-r", "--name-only", mergeBase], cwd)
    .split("\n")
    .filter((path) => path.trim() !== "");
  const specs = [];
  for (const path of allPaths) {
    if (!matchesAnyGlob(path, specPathGlobs)) {
      continue;
    }
    const content = tryShow(mergeBase, path, cwd);
    const parsed = content !== undefined ? parseFrontmatter(content) : undefined;
    specs.push({ path, status: parsed?.fields?.status });
  }
  return specs;
}

function loadGateRulesFromRef(ref, cwd) {
  const content = git(["show", `${ref}:${GATE_RULES_REPO_PATH}`], cwd);
  const rules = JSON.parse(content);
  const errors = validateGateRules(rules);
  if (errors.length > 0) {
    throw new Error(`基準ファイル（${ref}）の形式が不正です: ${errors.join(" / ")}`);
  }
  return rules;
}

function parseArgs(argv) {
  const args = { base: "origin/main" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") {
      args.input = argv[++i];
    } else if (argv[i] === "--base") {
      args.base = argv[++i];
    }
  }
  return args;
}

/**
 * CLI本体。process.exit は呼ばず { code, stdout, stderr } を返す（テストのため）。
 * code: 0 = gate不要 / 1 = 入力・実行エラー / 2 = gate必要
 */
export function runCli(argv, cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (!args.input) {
    return { code: 1, stderr: "--input <入力JSONのパス> を指定してください\n" };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(args.input, "utf-8"));
  } catch (error) {
    return { code: 1, stderr: `入力JSONを読み込めません: ${error instanceof Error ? error.message : String(error)}\n` };
  }

  const { input, errors: inputErrors } = parseInput(raw);
  if (inputErrors) {
    return { code: 1, stderr: `入力JSONが不正です: ${inputErrors.join(" / ")}\n` };
  }

  try {
    const mergeBase = git(["merge-base", args.base, "HEAD"], cwd).trim();
    const rules = loadGateRulesFromRef(args.base, cwd);
    const diff = buildDiff(mergeBase, cwd);
    const specs = buildSpecs(rules, mergeBase, cwd);

    const ctx = {
      diff,
      specs,
      issueBody: input.issueBody,
      taskMetadata: input.taskMetadata,
      failedAttempt: input.failedAttempt,
      consecutiveCiFailures: input.consecutiveCiFailures,
      reviewRuns: input.reviewRuns,
    };
    const result = evaluateGateRules(rules, ctx);
    return { code: result.gate ? 2 : 0, stdout: `${JSON.stringify(result)}\n` };
  } catch (error) {
    return { code: 1, stderr: `判定に失敗しました: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { code, stdout, stderr } = runCli(process.argv.slice(2));
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  process.exit(code);
}
