// SubagentStop フック。ハーネスの Planner・Implementer・spec-reviewer が終了したとき、
// そのサブエージェントのトランスクリプト（JSONL）から使用量を集計し、該当Issueに
// `<!-- harness:usage -->` コメントとして記録する。
// 決定の経緯: Issue #79（T15）。エージェント自身に書かせず、フックで機械的に記録する（Vault側 ADR 0008）。
//
// - 書き出すのは使用量（トークン数・所要時間・モデル名）とロール名・agent_id だけ。
//   プロンプトやトランスクリプトの内容は書き出さない（書き込み先Issueの特定にだけ使う）。
// - 失敗しても（トランスクリプトが読めない、gh のエラーなど）終了コードは常に 0。
//   記録の失敗でハーネス本体の運用を止めないため。理由は標準エラーに出す。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const USAGE_MARKER = "<!-- harness:usage -->";
// 記録の対象にするロール（SubagentStop の入力の agent_type。.claude/agents/*.md の name）。
export const TARGET_ROLES = ["planner", "implementer", "spec-reviewer"];
const GH_TIMEOUT_MS = 30_000;
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/** JSONL を1行ずつ JSON として読む。読めない行は飛ばす。 */
export function parseTranscript(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 書きかけの行などは集計の対象外にする
    }
  }
  return entries;
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * トランスクリプトの行から使用量を集計する。
 * 1つの応答（message.id）が複数行に分かれて記録され、後の行ほど output_tokens が確定値に近いため、
 * message.id ごとに最後の行の usage だけを数える。
 */
export function summarizeUsage(entries) {
  const usageById = new Map();
  const models = [];
  let first;
  let last;
  entries.forEach((entry, index) => {
    const time = Date.parse(entry?.timestamp ?? "");
    if (Number.isFinite(time)) {
      first = first === undefined ? time : Math.min(first, time);
      last = last === undefined ? time : Math.max(last, time);
    }
    const message = entry?.message;
    if (entry?.type !== "assistant" || !message?.usage) {
      return;
    }
    usageById.set(message.id ?? `line-${index}`, message.usage);
    if (typeof message.model === "string" && !message.model.startsWith("<") && !models.includes(message.model)) {
      models.push(message.model);
    }
  });

  const summary = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    duration_sec: first === undefined ? 0 : Math.round((last - first) / 1000),
    models,
  };
  for (const usage of usageById.values()) {
    summary.input_tokens += count(usage.input_tokens);
    summary.output_tokens += count(usage.output_tokens);
    summary.cache_read_tokens += count(usage.cache_read_input_tokens);
    summary.cache_creation_tokens += count(usage.cache_creation_input_tokens);
  }
  return summary;
}

/** 最初のユーザーメッセージ（サブエージェントへの依頼文）のテキスト。なければ undefined。 */
export function firstPrompt(entries) {
  const entry = entries.find((item) => item?.type === "user" && !item.isMeta && item.message);
  const content = entry?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return undefined;
}

function firstNumber(text, patterns) {
  let best;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && (best === undefined || match.index < best.index)) {
      best = match;
    }
  }
  return best ? Number(best[1]) : undefined;
}

/** 依頼文で最初に出てくる Issue の参照（`Issue #N` か `.../issues/N`）の番号。 */
export function findIssueRef(text) {
  return firstNumber(text ?? "", [/\bIssue\s*#([1-9]\d*)/i, /\/issues\/([1-9]\d*)/]);
}

/** 依頼文で最初に出てくる PR の参照（`PR #N` か `.../pull/N`）の番号。 */
export function findPullRef(text) {
  return firstNumber(text ?? "", [/\bPR\s*#([1-9]\d*)/i, /\/pull\/([1-9]\d*)/]);
}

/** PR本文の `## 関連Issue` の `Closes #N` 行（行全体が一致するもの）から Issue 番号を読む。 */
export function issueFromPrBody(body) {
  for (const line of (body ?? "").split(/\r?\n/)) {
    const match = line.trim().match(/^Closes #([1-9]\d*)$/);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

/**
 * 書き込み先のIssue番号を決める。決められなければ undefined（記録しない）。
 * - planner: 依頼文の最初の Issue 参照（計画対象の親Issue）
 * - implementer: 依頼文の最初の Issue 参照（タスクのIssue）
 * - spec-reviewer: 依頼文の最初の PR 参照 → そのPR本文の `Closes #N`
 */
export function resolveTargetIssue(role, prompt, runGh) {
  if (role === "spec-reviewer") {
    const pr = findPullRef(prompt);
    if (pr === undefined) {
      return undefined;
    }
    const body = runGh(["pr", "view", String(pr), "--json", "body", "--jq", ".body"]);
    return issueFromPrBody(body);
  }
  return findIssueRef(prompt);
}

/** `<!-- harness:usage -->` コメントの本文。 */
export function buildUsageComment(role, agentId, summary) {
  return [
    USAGE_MARKER,
    "## usage記録",
    "```yaml",
    `role: ${role}`,
    `agent_id: ${agentId}`,
    `models: [${summary.models.join(", ")}]`,
    `input_tokens: ${summary.input_tokens}`,
    `output_tokens: ${summary.output_tokens}`,
    `cache_read_tokens: ${summary.cache_read_tokens}`,
    `cache_creation_tokens: ${summary.cache_creation_tokens}`,
    `duration_sec: ${summary.duration_sec}`,
    "```",
    "",
    "SubagentStop フックによる自動記録（`.claude/hooks/record-subagent-usage.js`）。",
    "",
  ].join("\n");
}

function expandHome(path) {
  return path.startsWith("~") ? homedir() + path.slice(1) : path;
}

/**
 * フックの入力（SubagentStop）を受け取り、記録する。例外は投げうる（runHook が握りつぶす）。
 * 戻り値: { posted: true, issue } か { posted: false, reason }
 */
export function recordUsage(payload, { readFile, runGh }) {
  const role = payload?.agent_type;
  if (!TARGET_ROLES.includes(role)) {
    return { posted: false, reason: `対象外のロール: ${String(role)}` };
  }
  const transcriptPath = payload.agent_transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") {
    return { posted: false, reason: "agent_transcript_path がない" };
  }
  const entries = parseTranscript(readFile(expandHome(transcriptPath)));
  const issue = resolveTargetIssue(role, firstPrompt(entries), runGh);
  if (issue === undefined) {
    return { posted: false, reason: "書き込み先のIssueを特定できない" };
  }
  const body = buildUsageComment(role, payload.agent_id ?? "unknown", summarizeUsage(entries));
  runGh(["issue", "comment", String(issue), "--body-file", "-"], body);
  return { posted: true, issue };
}

function defaultRunGh(args, input) {
  return execFileSync("gh", args, {
    input,
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: GH_TIMEOUT_MS,
  });
}

const defaultDeps = {
  readFile: (path) => readFileSync(path, "utf-8"),
  runGh: defaultRunGh,
};

/** フック本体。例外を外に出さず、常に { code: 0 } を返す（記録の失敗でサブエージェントを止めない）。 */
export function runHook(stdinText, deps = defaultDeps) {
  try {
    const result = recordUsage(JSON.parse(stdinText), deps);
    return { code: 0, result, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 0, result: { posted: false, reason: "error" }, stderr: `record-subagent-usage: ${message}\n` };
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf-8");
  } catch {
    // 標準入力が読めなくても止めない
  }
  const { stderr } = runHook(stdin);
  if (stderr) {
    process.stderr.write(stderr);
  }
  process.exit(0);
}
