import { describe, expect, it } from "vitest";
import {
  WAITING_LABEL,
  alreadyNotified,
  buildNotification,
  latestProgressFields,
  notify,
  runCli,
} from "./notify.js";

type Comment = { body: string; createdAt: string; id?: string };
type View = { url: string; body: string; labels: { name: string }[]; comments: Comment[] };
type Call = { args: string[]; input?: string };

const URL = "https://github.com/sgmt-tmy/type-chat/issues/54";

function issueBody(gateReasons = "[irreversible, security_boundary]", maxAttempts = 3): string {
  return [
    "## 背景・目的",
    "",
    "## ハーネスメタデータ",
    "```yaml",
    "id: T10",
    "depends_on: [#53]",
    "gate: true",
    `gate_reasons: ${gateReasons}`,
    "risk: high",
    `max_attempts: ${maxAttempts}`,
    "```",
  ].join("\n");
}

function progress(attempt: number, status: string, lastFailure: string, createdAt: string): Comment {
  return {
    body: [
      "<!-- harness:progress -->",
      "## progressスナップショット",
      "```yaml",
      `attempt: ${attempt}`,
      `status: ${status}`,
      "branch: feat/54-notify-and-resume",
      "pr: none",
      `last_failure: ${lastFailure}`,
      "```",
    ].join("\n"),
    createdAt,
  };
}

function view(options: Partial<View> = {}): View {
  return {
    url: URL,
    body: issueBody(),
    labels: [{ name: "harness" }, { name: "gate" }, { name: "risk:high" }],
    comments: [],
    ...options,
  };
}

/** gh の実行をモックする。issue view には viewResult を返し、それ以外は呼び出しを記録するだけ。 */
function fakeGh(viewResult: View, failOn?: string) {
  const calls: Call[] = [];
  const run = (args: string[], input?: string): string => {
    calls.push({ args, input });
    if (failOn && args[1] === failOn) {
      throw new Error(`gh ${failOn} failed`);
    }
    return args[1] === "view" ? JSON.stringify(viewResult) : "";
  };
  return { calls, run };
}

describe("buildNotification", () => {
  it("WAIT_GATE: イベント・Issue番号とURL・gate_reasons・再開の手順を含み、ラベルを付ける", () => {
    const { body, addLabel } = buildNotification({
      event: "WAIT_GATE",
      issue: 54,
      url: URL,
      gateReasons: ["irreversible", "security_boundary"],
    });
    expect(addLabel).toBe(true);
    expect(body.split("\n")[0]).toBe("<!-- harness:notify event=WAIT_GATE -->");
    expect(body).toContain("- イベント: WAIT_GATE");
    expect(body).toContain(`- Issue: #54 ${URL}`);
    expect(body).toContain("gate_reasons: [irreversible, security_boundary]");
    expect(body).toContain("### 再開の手順");
    expect(body).toContain("`gate:approved` ラベルを付ける");
    expect(body).toContain(`\`${WAITING_LABEL}\` ラベルを外す`);
    expect(body).toContain("`/next-task` を手動で実行する");
  });

  it("ESCALATE: attempt・max_attempts・最後の失敗理由と再開の手順を含み、ラベルを付ける", () => {
    const { body, addLabel } = buildNotification({
      event: "ESCALATE",
      issue: 54,
      url: URL,
      attempt: "3",
      maxAttempts: 3,
      lastFailure: "npm run check の test で失敗",
    });
    expect(addLabel).toBe(true);
    expect(body.split("\n")[0]).toBe("<!-- harness:notify event=ESCALATE -->");
    expect(body).toContain("- イベント: ESCALATE");
    expect(body).toContain(`- Issue: #54 ${URL}`);
    expect(body).toContain("attempt: 3）が max_attempts（3）に達しました");
    expect(body).toContain("- 最後の失敗: npm run check の test で失敗");
    expect(body).toContain("### 再開の手順");
    expect(body).toContain(`\`${WAITING_LABEL}\` ラベルを外す`);
  });

  it("TASK_DONE: PR番号と再開の手順を含み、ラベルは付けない", () => {
    const { body, addLabel } = buildNotification({ event: "TASK_DONE", issue: 54, url: URL, pr: 70 });
    expect(addLabel).toBe(false);
    expect(body.split("\n")[0]).toBe("<!-- harness:notify event=TASK_DONE pr=#70 -->");
    expect(body).toContain("- イベント: TASK_DONE");
    expect(body).toContain(`- Issue: #54 ${URL}`);
    expect(body).toContain("- PR: #70");
    expect(body).toContain("マージする");
    expect(body).toContain("`/next-task` を手動で実行し");
  });

  it("どのイベントの本文にも、ワークフローを起動するメンション文字列を含まない", () => {
    for (const event of ["WAIT_GATE", "ESCALATE", "TASK_DONE"]) {
      const { body } = buildNotification({
        event,
        issue: 54,
        url: URL,
        gateReasons: ["irreversible"],
        attempt: "3",
        maxAttempts: 3,
        lastFailure: "x",
        pr: 70,
      });
      expect(body).not.toMatch(/@claude/i);
    }
  });
});

describe("latestProgressFields", () => {
  it("最新のprogressスナップショットのキーを返す", () => {
    const fields = latestProgressFields([
      progress(2, "failed", "新しい失敗", "2026-09-26T02:00:00Z"),
      progress(1, "failed", "古い失敗", "2026-09-26T01:00:00Z"),
      { body: "ふつうのコメント", createdAt: "2026-09-26T03:00:00Z" },
    ]);
    expect(fields).toMatchObject({ attempt: "2", status: "failed", last_failure: "新しい失敗" });
  });

  it("スナップショットがなければ undefined", () => {
    expect(latestProgressFields([])).toBeUndefined();
  });
});

describe("alreadyNotified", () => {
  const waitGate = buildNotification({ event: "WAIT_GATE", issue: 54, url: URL, gateReasons: ["irreversible"] });
  const notified = { body: waitGate.body, createdAt: "2026-09-26T01:00:00Z" };

  it("最新の通知が同じイベントで、ラベルが残っていれば送信済み", () => {
    expect(alreadyNotified(waitGate, view({ comments: [notified], labels: [{ name: WAITING_LABEL }] }))).toBe(true);
  });

  it("ラベルが外されていれば送り直す", () => {
    expect(alreadyNotified(waitGate, view({ comments: [notified] }))).toBe(false);
  });

  it("最新の通知が別のイベントなら送る", () => {
    const escalate = buildNotification({
      event: "ESCALATE",
      issue: 54,
      url: URL,
      attempt: "3",
      maxAttempts: 3,
      lastFailure: "x",
    });
    expect(alreadyNotified(escalate, view({ comments: [notified], labels: [{ name: WAITING_LABEL }] }))).toBe(
      false,
    );
  });

  it("TASK_DONE は同じPRの通知があれば送信済み、別のPRなら送る", () => {
    const done = buildNotification({ event: "TASK_DONE", issue: 54, url: URL, pr: 70 });
    const comments = [{ body: done.body, createdAt: "2026-09-26T01:00:00Z" }];
    expect(alreadyNotified(done, view({ comments }))).toBe(true);
    const other = buildNotification({ event: "TASK_DONE", issue: 54, url: URL, pr: 71 });
    expect(alreadyNotified(other, view({ comments }))).toBe(false);
  });
});

describe("notify（送信はモック）", () => {
  it("WAIT_GATE: Issueを読み、コメントしてから gate:waiting ラベルを付ける", () => {
    const gh = fakeGh(view());
    const result = notify({ event: "WAIT_GATE", issue: 54 }, gh.run);
    expect(result).toEqual({ sent: true, skipped: false, actions: ["comment", `label:${WAITING_LABEL}`], errors: [] });
    expect(gh.calls.map((call) => call.args)).toEqual([
      ["issue", "view", "54", "--json", "url,body,labels,comments"],
      ["issue", "comment", "54", "--body-file", "-"],
      ["issue", "edit", "54", "--add-label", WAITING_LABEL],
    ]);
    expect(gh.calls[1].input).toContain("gate_reasons: [irreversible, security_boundary]");
    expect(gh.calls[1].input).toContain(URL);
  });

  it("ESCALATE: 最新のprogressスナップショットの last_failure を本文に入れる", () => {
    const gh = fakeGh(
      view({
        comments: [
          progress(2, "failed", "古い失敗", "2026-09-26T01:00:00Z"),
          progress(3, "blocked", "typecheck で失敗（src/group.ts）", "2026-09-26T02:00:00Z"),
        ],
      }),
    );
    const result = notify({ event: "ESCALATE", issue: 54 }, gh.run);
    expect(result.sent).toBe(true);
    expect(gh.calls[1].input).toContain("attempt: 3）が max_attempts（3）に達しました");
    expect(gh.calls[1].input).toContain("- 最後の失敗: typecheck で失敗（src/group.ts）");
  });

  it("TASK_DONE: コメントだけを付け、ラベルは付けない", () => {
    const gh = fakeGh(view());
    const result = notify({ event: "TASK_DONE", issue: 54, pr: 70 }, gh.run);
    expect(result.actions).toEqual(["comment"]);
    expect(gh.calls.map((call) => call.args[1])).toEqual(["view", "comment"]);
    expect(gh.calls[1].input).toContain("- PR: #70");
  });

  it("送信済みなら何も送らない", () => {
    const body = buildNotification({
      event: "WAIT_GATE",
      issue: 54,
      url: URL,
      gateReasons: ["irreversible", "security_boundary"],
    }).body;
    const gh = fakeGh(
      view({
        comments: [{ body, createdAt: "2026-09-26T01:00:00Z" }],
        labels: [{ name: "gate" }, { name: WAITING_LABEL }],
      }),
    );
    expect(notify({ event: "WAIT_GATE", issue: 54 }, gh.run)).toEqual({
      sent: false,
      skipped: true,
      actions: [],
      errors: [],
    });
    expect(gh.calls).toHaveLength(1);
  });

  it("gate:approved ラベルには触れない", () => {
    const gh = fakeGh(view());
    notify({ event: "WAIT_GATE", issue: 54 }, gh.run);
    for (const call of gh.calls) {
      expect(call.args.join(" ")).not.toContain("gate:approved");
    }
  });

  it("メタデータを読めなければ送らずにエラー", () => {
    const gh = fakeGh(view({ body: "メタデータなし" }));
    const result = notify({ event: "WAIT_GATE", issue: 54 }, gh.run);
    expect(result.sent).toBe(false);
    expect(result.errors[0]).toContain("メタデータを読めません");
    expect(gh.calls).toHaveLength(1);
  });

  it("gh が失敗したらエラーを返す", () => {
    const gh = fakeGh(view(), "comment");
    const result = notify({ event: "WAIT_GATE", issue: 54 }, gh.run);
    expect(result.sent).toBe(false);
    expect(result.errors[0]).toContain("gh comment failed");
  });

  it("引数が不正なら gh を呼ばずにエラー", () => {
    const gh = fakeGh(view());
    expect(notify({ event: "DONE", issue: 54 }, gh.run).errors[0]).toContain("--event");
    expect(notify({ event: "TASK_DONE", issue: 54 }, gh.run).errors[0]).toContain("--pr");
    expect(notify({ event: "WAIT_GATE", issue: 54, pr: 70 }, gh.run).errors[0]).toContain("--pr");
    expect(notify({ event: "WAIT_GATE", issue: Number.NaN }, gh.run).errors[0]).toContain("--issue");
    expect(gh.calls).toHaveLength(0);
  });
});

describe("runCli", () => {
  it("送れたら終了コード 0 と結果のJSONを返す", () => {
    const gh = fakeGh(view());
    const { code, stdout } = runCli(["--event", "TASK_DONE", "--issue", "54", "--pr", "70"], gh.run);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ sent: true, actions: ["comment"] });
  });

  it("エラーなら終了コード 1", () => {
    const gh = fakeGh(view());
    const { code, stdout } = runCli(["--event", "WAIT_GATE", "--issue", "abc"], gh.run);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).errors[0]).toContain("--issue");
  });
});
