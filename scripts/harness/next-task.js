// ハーネスのタスクDAG（harness ラベルのIssue群）から、次に実行するタスクを1つ決める。
// ネットワークには出ず、渡されたファイルだけで判定する。同じ入力なら出力は必ず同じになる。
// 判定の順番と優先順位は Issue #53（T9）の「実装前の確認」への回答（2026-09-26）。
// 使い方: node scripts/harness/next-task.js --issues <file|-> --branches <file> --pulls <file>
//   --issues:   gh issue list --label harness --state all --limit 1000 --json number,title,body,labels,state,comments
//   --branches: git ls-remote --heads origin の出力
//   --pulls:    gh pr list --state all --limit 1000 --json number,headRefName,state

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHarnessMetadata } from "./metadata.js";

export const ROLE = "implementer";
export const PROGRESS_MARKER = "<!-- harness:progress -->";
// .claude/harness/conventions.md の「ブランチ名」
export const BRANCH_PATTERN = /^(feat|fix)\/([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const RISK_LABEL_PREFIX = "risk:";

// 結果の優先順位（ERROR は他より先に判定する）。同じ種類の中では番号が一番小さいものを選ぶ。
const PRIORITY = ["RUN", "ESCALATE", "WAIT_GATE"];

/** ブランチ名から Issue 番号を返す。規約に一致しなければ undefined。 */
export function issueNumberOfBranch(name) {
  const match = BRANCH_PATTERN.exec(name);
  return match ? Number(match[2]) : undefined;
}

/** `git ls-remote --heads` の出力からブランチ名の配列を返す。 */
export function parseLsRemote(output) {
  const names = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^[0-9a-f]+\s+refs\/heads\/(.+)$/);
    if (match) {
      names.push(match[1].trim());
    }
  }
  return names;
}

/**
 * コメントの配列から、最新のprogressスナップショット（1行目がマーカーのもの）を読む。
 * なければ { attempt: 0 }。attempt が読めなければ { error }。
 */
export function latestProgress(comments) {
  const snapshots = comments
    .filter((comment) => comment.body.split(/\r?\n/)[0].trim() === PROGRESS_MARKER)
    .sort((a, b) => compareStrings(a.createdAt, b.createdAt) || compareStrings(String(a.id), String(b.id)));
  const latest = snapshots.at(-1);
  if (!latest) {
    return { attempt: 0 };
  }

  const lines = latest.body.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === "```yaml");
  const close = open === -1 ? -1 : lines.slice(open + 1).findIndex((line) => line.trim() === "```");
  const block = close === -1 ? [] : lines.slice(open + 1, open + 1 + close);
  const attemptLine = block.map((line) => line.match(/^attempt:\s*(.*)$/)).find(Boolean);
  const statusLine = block.map((line) => line.match(/^status:\s*(.*)$/)).find(Boolean);
  if (!attemptLine || !/^[1-9]\d*$/.test(attemptLine[1].trim())) {
    return { error: "最新のprogressスナップショットの attempt を読めません" };
  }
  return { attempt: Number(attemptLine[1].trim()), status: statusLine?.[1].trim() };
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function labelNames(issue) {
  return issue.labels.map((label) => label.name);
}

/** 入力の形を検証する。問題があればエラーメッセージの配列を返す。 */
function validateShape(issues, pulls) {
  const errors = [];
  if (!Array.isArray(issues)) {
    return ["--issues は Issue の配列にしてください"];
  }
  if (!Array.isArray(pulls)) {
    return ["--pulls は PR の配列にしてください"];
  }
  for (const issue of issues) {
    if (
      typeof issue !== "object" ||
      issue === null ||
      !Number.isInteger(issue.number) ||
      !["OPEN", "CLOSED"].includes(issue.state) ||
      !Array.isArray(issue.labels)
    ) {
      errors.push(`Issue の形式が不正です（${JSON.stringify(issue?.number ?? issue)}）`);
    } else if (issue.state === "OPEN" && (typeof issue.body !== "string" || !Array.isArray(issue.comments))) {
      errors.push(`#${issue.number}: open の Issue には body と comments が必要です`);
    }
  }
  for (const pull of pulls) {
    if (typeof pull !== "object" || pull === null || typeof pull.headRefName !== "string") {
      errors.push(`PR の形式が不正です（${JSON.stringify(pull?.number ?? pull)}）`);
    }
  }
  const numbers = issues.map((issue) => issue?.number);
  const duplicated = numbers.filter((number, index) => numbers.indexOf(number) !== index);
  for (const number of [...new Set(duplicated)]) {
    errors.push(`#${number}: Issue が重複しています`);
  }
  return errors;
}

/** open の Issue 同士の依存に循環があれば、循環に含まれる番号（昇順）を返す。 */
function findCycle(openNumbers, dependsOn) {
  const state = new Map();
  const stack = [];
  const visit = (number) => {
    state.set(number, "visiting");
    stack.push(number);
    for (const dep of dependsOn.get(number) ?? []) {
      if (!openNumbers.has(dep)) {
        continue;
      }
      if (state.get(dep) === "visiting") {
        return stack.slice(stack.indexOf(dep));
      }
      if (!state.has(dep)) {
        const cycle = visit(dep);
        if (cycle) {
          return cycle;
        }
      }
    }
    stack.pop();
    state.set(number, "done");
    return undefined;
  };
  for (const number of [...openNumbers].sort((a, b) => a - b)) {
    if (!state.has(number)) {
      const cycle = visit(number);
      if (cycle) {
        return [...cycle].sort((a, b) => a - b);
      }
    }
  }
  return undefined;
}

function output(result, fields = {}) {
  const issue = fields.issue ?? null;
  const role = fields.role ?? null;
  const summary = issue === null ? result : `${result} #${issue}${role ? ` (${role})` : ""}`;
  return {
    result,
    issue,
    role,
    summary,
    attention: fields.attention ?? [],
    errors: fields.errors ?? [],
  };
}

/**
 * 次に実行するタスクを決める。
 * input: { issues: gh issue list の出力, branches: ブランチ名の配列, pulls: gh pr list の出力 }
 * 返り値: { result, issue, role, summary, attention, errors }（キーの順番は固定）
 */
export function decideNextTask({ issues, branches, pulls }) {
  const shapeErrors = validateShape(issues, pulls);
  if (shapeErrors.length > 0) {
    return output("ERROR", { errors: shapeErrors });
  }

  const sorted = [...issues].sort((a, b) => a.number - b.number);
  const byNumber = new Map(sorted.map((issue) => [issue.number, issue]));
  const open = sorted.filter((issue) => issue.state === "OPEN");
  if (open.length === 0) {
    return output("DONE");
  }

  // 着手済みの判定に使う、Issue番号ごとのブランチ名（origin のブランチと PR の headブランチ）
  const branchesByNumber = new Map();
  for (const name of branches) {
    const number = issueNumberOfBranch(name);
    if (number !== undefined) {
      branchesByNumber.set(number, [...(branchesByNumber.get(number) ?? []), name]);
    }
  }
  const pullHeads = new Set(pulls.map((pull) => issueNumberOfBranch(pull.headRefName)).filter((n) => n !== undefined));

  const errors = [];
  const tasks = [];
  for (const issue of open) {
    const labels = labelNames(issue);
    const prefix = `#${issue.number}`;
    if (labels.includes("harness-epic")) {
      errors.push(`${prefix}: harness と harness-epic が同時に付いています`);
      continue;
    }

    const { metadata, errors: metadataErrors } = parseHarnessMetadata(issue.body);
    if (metadataErrors) {
      errors.push(...metadataErrors.map((message) => `${prefix}: ${message}`));
      continue;
    }
    if (metadata.gate !== labels.includes("gate")) {
      errors.push(`${prefix}: メタデータの gate（${metadata.gate}）と gate ラベルが食い違っています`);
    }
    const riskLabels = labels.filter((name) => name.startsWith(RISK_LABEL_PREFIX));
    if (riskLabels.length !== 1 || riskLabels[0] !== `${RISK_LABEL_PREFIX}${metadata.risk}`) {
      errors.push(`${prefix}: メタデータの risk（${metadata.risk}）と risk:* ラベルが食い違っています`);
    }
    for (const dep of metadata.depends_on) {
      if (!byNumber.has(dep)) {
        errors.push(`${prefix}: depends_on の #${dep} が入力にありません`);
      }
    }
    const issueBranches = [...(branchesByNumber.get(issue.number) ?? [])].sort();
    if (issueBranches.length > 1) {
      errors.push(`${prefix}: 同じ番号のブランチが2本以上あります（${issueBranches.join(", ")}）`);
    }
    const progress = latestProgress(issue.comments);
    if (progress.error) {
      errors.push(`${prefix}: ${progress.error}`);
    }

    tasks.push({
      number: issue.number,
      metadata,
      labels,
      progress,
      started: issueBranches.length > 0 || pullHeads.has(issue.number),
    });
  }

  const cycle = findCycle(
    new Set(open.map((issue) => issue.number)),
    new Map(tasks.map((task) => [task.number, task.metadata.depends_on])),
  );
  if (cycle) {
    errors.push(`依存が循環しています（${cycle.map((n) => `#${n}`).join(", ")}）`);
  }
  if (errors.length > 0) {
    return output("ERROR", { errors });
  }

  const decisions = [];
  for (const task of tasks) {
    const depsClosed = task.metadata.depends_on.every((dep) => byNumber.get(dep).state === "CLOSED");
    if (!depsClosed) {
      continue;
    }
    if (task.progress.attempt >= task.metadata.max_attempts && task.progress.status !== "pr_open") {
      decisions.push({ result: "ESCALATE", issue: task.number });
    } else if (task.started) {
      continue;
    } else if (task.metadata.gate && !task.labels.includes("gate:approved")) {
      decisions.push({ result: "WAIT_GATE", issue: task.number });
    } else {
      decisions.push({ result: "RUN", issue: task.number });
    }
  }

  for (const result of PRIORITY) {
    const chosen = decisions.find((decision) => decision.result === result);
    if (chosen) {
      const attention = decisions.filter(
        (decision) => decision !== chosen && decision.result !== "RUN",
      );
      return output(result, {
        issue: chosen.issue,
        role: result === "RUN" ? ROLE : null,
        attention,
      });
    }
  }
  return output("BLOCKED");
}

function readSource(path, readStdin) {
  return path === "-" ? readStdin() : readFileSync(path, "utf-8");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const match = argv[i].match(/^--(issues|branches|pulls)$/);
    if (match) {
      args[match[1]] = argv[++i];
    }
  }
  return args;
}

/**
 * CLI本体。process.exit は呼ばず { code, stdout, stderr } を返す（テストのため）。
 * code: 0 = 判定できた（RUN / WAIT_GATE / ESCALATE / BLOCKED / DONE） / 1 = ERROR
 */
export function runCli(argv, readStdin = () => readFileSync(0, "utf-8")) {
  const args = parseArgs(argv);
  const missing = ["issues", "branches", "pulls"].filter((key) => !args[key]);
  let result;
  if (missing.length > 0) {
    result = output("ERROR", { errors: missing.map((key) => `--${key} を指定してください`) });
  } else {
    try {
      result = decideNextTask({
        issues: JSON.parse(readSource(args.issues, readStdin)),
        branches: parseLsRemote(readSource(args.branches, readStdin)),
        pulls: JSON.parse(readSource(args.pulls, readStdin)),
      });
    } catch (error) {
      result = output("ERROR", {
        errors: [`入力を読み込めません: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return { code: result.result === "ERROR" ? 1 : 0, stdout: `${JSON.stringify(result)}\n` };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { code, stdout } = runCli(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exit(code);
}
