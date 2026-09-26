// オーケストレーターが止まったとき（WAIT_GATE / ESCALATE）と、タスクのPRができたとき（TASK_DONE）に人へ通知する。
// 通知の手段は、該当Issueへのコメントと `gate:waiting` ラベル（GitHub標準の通知で人に届く）。
// 決定の経緯: Issue #54（T10）のgate承認コメント（2026-09-26。案Aで開始）。
//   → Issue #73（T13）のgate承認コメント（2026-09-26）で、本人アカウントでは通知が届かないことが分かり、
//     ボット用GitHubアカウントのPATで gh を実行する方式に変更（詳細は Vault側 ADR 0006）。
// 使い方: node scripts/harness/notify.js --event <WAIT_GATE|ESCALATE|TASK_DONE> --issue <番号> [--pr <番号>]
//   gh コマンドで Issue を読み、コメントとラベルを付ける。環境変数 HARNESS_NOTIFY_BOT_TOKEN に
//   ボットアカウントのPATを渡す（gh の GH_TOKEN として使う。リポジトリには一切書き込まない）。
//   未設定ならエラーにする（本人アカウントで実行すると、GitHubは自分自身の操作を通知しないため）。

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHarnessMetadata } from "./metadata.js";
import { PROGRESS_MARKER } from "./next-task.js";

export const EVENTS = ["WAIT_GATE", "ESCALATE", "TASK_DONE"];
export const WAITING_LABEL = "gate:waiting";
// gh をボットアカウントで実行するためのPATを渡す環境変数（Issue #73 / T13）。
export const BOT_TOKEN_ENV = "HARNESS_NOTIFY_BOT_TOKEN";
// 人の判断待ちで止まったイベント。WAITING_LABEL を付ける
const WAITING_EVENTS = ["WAIT_GATE", "ESCALATE"];
const NOTIFY_MARKER_PATTERN = /^<!-- harness:notify event=([A-Z_]+)(?: pr=#(\d+))? -->$/;

/** 通知コメントの1行目（マーカー）。重複の判定に使う。 */
export function notifyMarker(event, pr) {
  return `<!-- harness:notify event=${event}${pr ? ` pr=#${pr}` : ""} -->`;
}

function firstLine(body) {
  return body.split(/\r?\n/)[0].trim();
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortByCreated(comments) {
  return [...comments].sort(
    (a, b) => compareStrings(a.createdAt, b.createdAt) || compareStrings(String(a.id), String(b.id)),
  );
}

/** 最新のprogressスナップショットの yaml ブロックを { キー: 値 } で返す。なければ undefined。 */
export function latestProgressFields(comments) {
  const latest = sortByCreated(comments)
    .filter((comment) => firstLine(comment.body) === PROGRESS_MARKER)
    .at(-1);
  if (!latest) {
    return undefined;
  }
  const lines = latest.body.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === "```yaml");
  const close = open === -1 ? -1 : lines.slice(open + 1).findIndex((line) => line.trim() === "```");
  const fields = {};
  for (const line of close === -1 ? [] : lines.slice(open + 1, open + 1 + close)) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      fields[match[1]] = match[2].trim();
    }
  }
  return fields;
}

/** 最新の通知コメントのマーカーを返す。なければ undefined。 */
export function latestNotifyMarker(comments) {
  return sortByCreated(comments)
    .map((comment) => firstLine(comment.body))
    .filter((line) => NOTIFY_MARKER_PATTERN.test(line))
    .at(-1);
}

const TITLES = {
  WAIT_GATE: "gateの承認待ちで止まりました",
  ESCALATE: "試行回数が上限に達したため止まりました",
  TASK_DONE: "タスクのPRができました（レビュー・マージ待ち）",
};

function reasonLines(input) {
  if (input.event === "WAIT_GATE") {
    return [`- 止まった理由: gate が必要なタスクです（gate_reasons: [${input.gateReasons.join(", ")}]）`];
  }
  if (input.event === "ESCALATE") {
    return [
      `- 止まった理由: 試行回数（attempt: ${input.attempt}）が max_attempts（${input.maxAttempts}）に達しました`,
      `- 最後の失敗: ${input.lastFailure}`,
    ];
  }
  return [`- PR: #${input.pr}`];
}

function resumeLines(event) {
  if (event === "WAIT_GATE") {
    return [
      "1. Issue本文の「人が判断すること」を読み、`## gate承認` で始まるコメントに判断を書く",
      "2. Issueに `gate:approved` ラベルを付ける",
      `3. Issueから \`${WAITING_LABEL}\` ラベルを外す`,
      "4. `/next-task` を手動で実行する",
    ];
  }
  if (event === "ESCALATE") {
    return [
      "1. progressスナップショットの `last_failure` と作業ブランチを確認し、続けるか（何を変えて再試行するか、`max_attempts` を増やすか）、Issueを分け直すかを決め、Issueにコメントで記録する",
      "2. 続けるなら、必要に応じてメタデータの `max_attempts` を書き換える",
      `3. Issueから \`${WAITING_LABEL}\` ラベルを外す`,
      "4. 着手済みのタスクはオーケストレーターが再開しないため、Implementer に Issue番号を渡して手動で呼ぶ。Issueを分け直した場合は `/next-task` を手動で実行する",
    ];
  }
  return [
    "1. PRをレビューし、問題がなければマージする（Issueは `Closes` で閉じる）",
    "2. `/next-task` を手動で実行し、次のタスクへ進める",
  ];
}

/**
 * 通知の本文を組み立てる。
 * input: { event, issue, url, gateReasons?, attempt?, maxAttempts?, lastFailure?, pr? }
 * 返り値: { body, addLabel }。addLabel が true なら WAITING_LABEL を付ける。
 */
export function buildNotification(input) {
  const body = [
    notifyMarker(input.event, input.event === "TASK_DONE" ? input.pr : undefined),
    `## ハーネス通知: ${TITLES[input.event]}`,
    "",
    `- イベント: ${input.event}`,
    `- Issue: #${input.issue} ${input.url}`,
    ...reasonLines(input),
    "",
    "### 再開の手順",
    ...resumeLines(input.event),
    "",
  ].join("\n");
  return { body, addLabel: WAITING_EVENTS.includes(input.event) };
}

/**
 * gh issue view の結果から通知の入力を組み立てる。
 * 成功時は { input }、失敗時は { error }。
 */
export function notificationInput({ event, issue, pr }, view) {
  const base = { event, issue, url: view.url };
  if (event === "TASK_DONE") {
    return { input: { ...base, pr } };
  }
  const { metadata, errors } = parseHarnessMetadata(view.body);
  if (errors) {
    return { error: `#${issue}: メタデータを読めません（${errors.join(" / ")}）` };
  }
  if (event === "WAIT_GATE") {
    return { input: { ...base, gateReasons: metadata.gate_reasons } };
  }
  const progress = latestProgressFields(view.comments) ?? {};
  return {
    input: {
      ...base,
      attempt: progress.attempt ?? "不明",
      maxAttempts: metadata.max_attempts,
      lastFailure: progress.last_failure && progress.last_failure !== "none" ? progress.last_failure : "記録なし",
    },
  };
}

/** 同じ通知をすでに送っていれば true。止まったイベントは、ラベルが外されていれば送り直す。 */
export function alreadyNotified(notification, view) {
  const marker = firstLine(notification.body);
  if (latestNotifyMarker(view.comments) !== marker) {
    return false;
  }
  return !notification.addLabel || view.labels.some((label) => label.name === WAITING_LABEL);
}

function validateArgs({ event, issue, pr }) {
  const errors = [];
  if (!EVENTS.includes(event)) {
    errors.push(`--event は ${EVENTS.join(" / ")} のいずれかにしてください（${event}）`);
  }
  if (!Number.isInteger(issue) || issue < 1) {
    errors.push("--issue に Issue 番号を指定してください");
  }
  if (event === "TASK_DONE" && (!Number.isInteger(pr) || pr < 1)) {
    errors.push("TASK_DONE では --pr に PR 番号を指定してください");
  }
  if (event !== "TASK_DONE" && pr !== undefined) {
    errors.push("--pr は TASK_DONE のときだけ指定してください");
  }
  return errors;
}

function tokenFromEnv() {
  return process.env[BOT_TOKEN_ENV];
}

/**
 * 通知を送る。runGh(args, stdin?) は gh を実行して標準出力を返す関数（失敗時は例外）。テストではモックを渡す。
 * token はボットアカウントのPAT（省略時は環境変数 HARNESS_NOTIFY_BOT_TOKEN から読む）。未設定ならエラーにする。
 * 返り値: { sent, skipped, actions, errors }
 */
export function notify(args, runGh, token = tokenFromEnv()) {
  const errors = validateArgs(args);
  if (!token) {
    errors.push(`${BOT_TOKEN_ENV} が設定されていません（notify.js の実行にはボットアカウントのPATを環境変数で渡す）`);
  }
  if (errors.length > 0) {
    return { sent: false, skipped: false, actions: [], errors };
  }
  const issue = String(args.issue);
  try {
    const view = JSON.parse(runGh(["issue", "view", issue, "--json", "url,body,labels,comments"]));
    const { input, error } = notificationInput(args, view);
    if (error) {
      return { sent: false, skipped: false, actions: [], errors: [error] };
    }
    const notification = buildNotification(input);
    if (alreadyNotified(notification, view)) {
      return { sent: false, skipped: true, actions: [], errors: [] };
    }
    const actions = [];
    runGh(["issue", "comment", issue, "--body-file", "-"], notification.body);
    actions.push("comment");
    if (notification.addLabel) {
      runGh(["issue", "edit", issue, "--add-label", WAITING_LABEL]);
      actions.push(`label:${WAITING_LABEL}`);
    }
    return { sent: true, skipped: false, actions, errors: [] };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      actions: [],
      errors: [`gh の実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const match = argv[i].match(/^--(event|issue|pr)$/);
    if (match) {
      const value = argv[++i];
      args[match[1]] = match[1] === "event" ? value : /^\d+$/.test(value ?? "") ? Number(value) : NaN;
    }
  }
  return args;
}

/** gh に渡す環境変数を組み立てる。token があれば GH_TOKEN として渡す（gh はこれをボットアカウントの認証として使う）。 */
export function buildGhEnv(token = tokenFromEnv()) {
  return token ? { ...process.env, GH_TOKEN: token } : process.env;
}

function defaultRunGh(args, input) {
  return execFileSync("gh", args, {
    input,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: buildGhEnv(),
  });
}

/** CLI本体。process.exit は呼ばず { code, stdout } を返す（テストのため）。code: 0 = 送った／送信済み、1 = エラー */
export function runCli(argv, runGh = defaultRunGh) {
  const result = notify(parseArgs(argv), runGh);
  return { code: result.errors.length > 0 ? 1 : 0, stdout: `${JSON.stringify(result)}\n` };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { code, stdout } = runCli(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exit(code);
}
