import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideNextTask, latestProgress, parseLsRemote, runCli } from "./next-task.js";

type Comment = { body: string; createdAt: string; id?: string };
type Issue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: { name: string }[];
  comments: Comment[];
};
type Pull = { number: number; headRefName: string; state: string };

type IssueOptions = {
  state?: "OPEN" | "CLOSED";
  dependsOn?: number[];
  gate?: boolean;
  risk?: string;
  maxAttempts?: number;
  labels?: string[];
  comments?: Comment[];
  body?: string;
};

function issue(number: number, options: IssueOptions = {}): Issue {
  const gate = options.gate ?? false;
  const risk = options.risk ?? "low";
  const body =
    options.body ??
    [
      "## 背景・目的",
      "",
      "## ハーネスメタデータ",
      "```yaml",
      `id: T${number}`,
      `depends_on: [${(options.dependsOn ?? []).map((n) => `#${n}`).join(", ")}]`,
      `gate: ${gate}`,
      `gate_reasons: ${gate ? "[spec_ambiguity]" : "[]"}`,
      `risk: ${risk}`,
      `max_attempts: ${options.maxAttempts ?? 3}`,
      "```",
    ].join("\n");
  const labels = options.labels ?? ["harness", `risk:${risk}`, ...(gate ? ["gate"] : [])];
  return {
    number,
    title: `[harness] T${number} タスク`,
    body,
    state: options.state ?? "OPEN",
    labels: labels.map((name) => ({ name })),
    comments: options.comments ?? [],
  };
}

function progress(attempt: number | string, status: string, createdAt = "2026-09-26T00:00:00Z"): Comment {
  return {
    body: [
      "<!-- harness:progress -->",
      "## progressスナップショット",
      "```yaml",
      `attempt: ${attempt}`,
      `status: ${status}`,
      "branch: none",
      "pr: none",
      "last_failure: none",
      "```",
    ].join("\n"),
    createdAt,
  };
}

function decide(issues: Issue[], branches: string[] = [], pulls: Pull[] = []) {
  return decideNextTask({ issues, branches, pulls });
}

describe("decideNextTask", () => {
  it("依存がすべて closed で gate: false なら RUN（役は implementer）", () => {
    expect(decide([issue(1, { state: "CLOSED" }), issue(2, { dependsOn: [1] })])).toEqual({
      result: "RUN",
      issue: 2,
      role: "implementer",
      summary: "RUN #2 (implementer)",
      attention: [],
      errors: [],
    });
  });

  it("依存が未完了のタスクは選ばず、ほかになければ BLOCKED", () => {
    const result = decide([issue(1, { state: "CLOSED" }), issue(2), issue(3, { dependsOn: [1, 2] })], ["feat/2-a"]);

    expect(result.result).toBe("BLOCKED");
    expect(result.issue).toBeNull();
    expect(result.summary).toBe("BLOCKED");
  });

  it("依存が未完了のタスクより、番号が大きくても実行できるタスクを選ぶ", () => {
    expect(decide([issue(1), issue(2, { dependsOn: [1] })], ["feat/1-a"]).result).toBe("BLOCKED");
    expect(decide([issue(1), issue(2, { dependsOn: [1] }), issue(3)], ["feat/1-a"]).issue).toBe(3);
  });

  it("gate: true で gate:approved がなければ WAIT_GATE", () => {
    const result = decide([issue(4, { gate: true })]);

    expect(result).toMatchObject({ result: "WAIT_GATE", issue: 4, role: null, summary: "WAIT_GATE #4" });
  });

  it("gate: true で gate:approved があれば RUN", () => {
    const result = decide([issue(4, { gate: true, labels: ["harness", "risk:low", "gate", "gate:approved"] })]);

    expect(result).toMatchObject({ result: "RUN", issue: 4, role: "implementer" });
  });

  it("gate: false なら gate:approved がなくても RUN", () => {
    expect(decide([issue(5)]).result).toBe("RUN");
  });

  describe("着手済み", () => {
    it("番号が一致するブランチが origin にあれば選ばない", () => {
      expect(decide([issue(6), issue(7)], ["feat/6-something"]).issue).toBe(7);
    });

    it("番号が一致する fix/ ブランチでも着手済み", () => {
      expect(decide([issue(6)], ["fix/6-bug"]).result).toBe("BLOCKED");
    });

    it("headブランチの番号が一致するPRがあれば、ブランチがなくても着手済み（PRの状態は問わない）", () => {
      expect(decide([issue(6)], [], [{ number: 60, headRefName: "feat/6-something", state: "CLOSED" }]).result).toBe(
        "BLOCKED",
      );
    });

    it("規約に一致しないブランチは、どのIssueにも結びつかない", () => {
      expect(decide([issue(6)], ["docs/6-something", "feat/6_x", "feat/06-x", "main"]).issue).toBe(6);
    });

    it("gate未承認でも、着手済みなら WAIT_GATE にしない", () => {
      expect(decide([issue(6, { gate: true })], ["feat/6-x"]).result).toBe("BLOCKED");
    });
  });

  describe("試行回数", () => {
    it("最新の attempt が max_attempts 以上で pr_open でなければ ESCALATE（着手済みでも）", () => {
      const result = decide([issue(8, { maxAttempts: 3, comments: [progress(3, "blocked")] })], ["feat/8-x"]);

      expect(result).toMatchObject({ result: "ESCALATE", issue: 8, role: null, summary: "ESCALATE #8" });
    });

    it("attempt が max_attempts を超えていても ESCALATE", () => {
      expect(decide([issue(8, { maxAttempts: 2, comments: [progress(3, "failed")] })]).result).toBe("ESCALATE");
    });

    it("attempt が max_attempts と同じでも pr_open なら ESCALATE にしない", () => {
      expect(decide([issue(8, { comments: [progress(3, "pr_open")] })], ["feat/8-x"]).result).toBe("BLOCKED");
    });

    it("attempt が max_attempts 未満なら ESCALATE にしない", () => {
      expect(decide([issue(8, { comments: [progress(2, "blocked")] })]).result).toBe("RUN");
    });

    it("createdAt が最新のスナップショットを使う（配列の順番によらない）", () => {
      const comments = [progress(3, "blocked", "2026-09-27T00:00:00Z"), progress(1, "in_progress", "2026-09-26T00:00:00Z")];

      expect(decide([issue(8, { comments })]).result).toBe("ESCALATE");
      expect(decide([issue(8, { comments: [...comments].reverse() })]).result).toBe("ESCALATE");
    });

    it("依存が未完了なら ESCALATE にしない", () => {
      expect(decide([issue(1), issue(8, { dependsOn: [1], comments: [progress(3, "blocked")] })], ["feat/1-x"]).result).toBe(
        "BLOCKED",
      );
    });
  });

  describe("ERROR", () => {
    it("依存が循環していれば ERROR", () => {
      const result = decide([issue(1, { dependsOn: [3] }), issue(2, { dependsOn: [1] }), issue(3, { dependsOn: [2] }), issue(4)]);

      expect(result.result).toBe("ERROR");
      expect(result.errors).toEqual(["依存が循環しています（#1, #2, #3）"]);
    });

    it("自分自身への依存も循環として ERROR", () => {
      expect(decide([issue(1, { dependsOn: [1] })]).errors).toEqual(["依存が循環しています（#1）"]);
    });

    it("closed の Issue を経由する依存は循環として扱わない", () => {
      expect(decide([issue(1, { state: "CLOSED", dependsOn: [2] }), issue(2, { dependsOn: [1] })]).result).toBe("RUN");
    });

    it("メタデータが不正なら ERROR", () => {
      const result = decide([issue(1, { body: "## ハーネスメタデータ\nなし" }), issue(2)]);

      expect(result.result).toBe("ERROR");
      expect(result.errors[0]).toMatch(/^#1: /);
    });

    it("メタデータの gate と gate ラベルが食い違えば ERROR", () => {
      expect(decide([issue(1, { labels: ["harness", "risk:low", "gate"] })]).errors).toEqual([
        "#1: メタデータの gate（false）と gate ラベルが食い違っています",
      ]);
    });

    it("メタデータの risk と risk:* ラベルが食い違えば ERROR", () => {
      expect(decide([issue(1, { labels: ["harness", "risk:high"] })]).result).toBe("ERROR");
      expect(decide([issue(1, { labels: ["harness", "risk:low", "risk:high"] })]).result).toBe("ERROR");
    });

    it("harness-epic が付いていれば ERROR", () => {
      expect(decide([issue(1, { labels: ["harness", "harness-epic", "risk:low"] })]).result).toBe("ERROR");
    });

    it("depends_on が入力にない Issue を指せば ERROR", () => {
      expect(decide([issue(2, { dependsOn: [99] })]).errors).toEqual(["#2: depends_on の #99 が入力にありません"]);
    });

    it("同じ番号のブランチが2本以上あれば ERROR", () => {
      expect(decide([issue(2)], ["feat/2-a", "fix/2-b"]).errors).toEqual([
        "#2: 同じ番号のブランチが2本以上あります（feat/2-a, fix/2-b）",
      ]);
    });

    it("最新のprogressスナップショットの attempt が読めなければ ERROR", () => {
      expect(decide([issue(2, { comments: [progress("x", "failed")] })]).result).toBe("ERROR");
    });

    it("open の Issue に comments がなければ ERROR", () => {
      const { comments: _comments, ...withoutComments } = issue(2);
      void _comments;

      expect(decideNextTask({ issues: [withoutComments], branches: [], pulls: [] }).result).toBe("ERROR");
    });

    it("closed の Issue のメタデータは検証しない", () => {
      expect(decide([issue(1, { state: "CLOSED", body: "本文なし" }), issue(2, { dependsOn: [1] })]).result).toBe("RUN");
    });
  });

  it("open の Issue がなければ DONE", () => {
    expect(decide([issue(1, { state: "CLOSED" }), issue(2, { state: "CLOSED" })])).toEqual({
      result: "DONE",
      issue: null,
      role: null,
      summary: "DONE",
      attention: [],
      errors: [],
    });
  });

  it("入力が空でも DONE", () => {
    expect(decide([]).result).toBe("DONE");
  });

  describe("候補が複数あるとき", () => {
    it("RUN の候補が複数あれば、入力の順番によらず番号が一番小さいものを選ぶ", () => {
      const issues = [issue(12), issue(10), issue(11)];

      expect(decide(issues).issue).toBe(10);
      expect(decide([...issues].reverse()).issue).toBe(10);
    });

    it("RUN > ESCALATE > WAIT_GATE の順に選び、ほかの ESCALATE / WAIT_GATE を attention に番号順で並べる", () => {
      const issues = [
        issue(13),
        issue(10, { gate: true }),
        issue(11, { comments: [progress(3, "blocked")] }),
        issue(12, { gate: true }),
      ];

      expect(decide(issues)).toEqual({
        result: "RUN",
        issue: 13,
        role: "implementer",
        summary: "RUN #13 (implementer)",
        attention: [
          { result: "WAIT_GATE", issue: 10 },
          { result: "ESCALATE", issue: 11 },
          { result: "WAIT_GATE", issue: 12 },
        ],
        errors: [],
      });
      expect(decide(issues.slice(1))).toMatchObject({
        result: "ESCALATE",
        issue: 11,
        attention: [
          { result: "WAIT_GATE", issue: 10 },
          { result: "WAIT_GATE", issue: 12 },
        ],
      });
    });

    it("ERROR は他のどの結果よりも優先する", () => {
      expect(decide([issue(1), issue(2, { dependsOn: [99] })]).result).toBe("ERROR");
    });
  });
});

describe("latestProgress", () => {
  it("マーカーが1行目にないコメントは読まない", () => {
    expect(latestProgress([{ body: `前置き\n${progress(3, "blocked").body}`, createdAt: "2026-09-26T00:00:00Z" }])).toEqual({
      attempt: 0,
    });
  });

  it("status も読む", () => {
    expect(latestProgress([progress(2, "failed")])).toEqual({ attempt: 2, status: "failed" });
  });
});

describe("parseLsRemote", () => {
  it("refs/heads/ のブランチ名だけを取り出す", () => {
    const output = ["abc123\trefs/heads/feat/53-next-task", "def456\trefs/tags/v1", "0a1b\trefs/heads/main", ""].join("\n");

    expect(parseLsRemote(output)).toEqual(["feat/53-next-task", "main"]);
  });
});

describe("runCli", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function writeInputs(issues: unknown, lsRemote: string, pulls: unknown) {
    dir = mkdtempSync(join(tmpdir(), "next-task-"));
    const paths = { issues: join(dir, "issues.json"), branches: join(dir, "branches.txt"), pulls: join(dir, "pulls.json") };
    writeFileSync(paths.issues, JSON.stringify(issues));
    writeFileSync(paths.branches, lsRemote);
    writeFileSync(paths.pulls, JSON.stringify(pulls));
    return paths;
  }

  const fixtureIssues = [
    issue(1, { state: "CLOSED" }),
    issue(2, { dependsOn: [1] }),
    issue(3, { gate: true, dependsOn: [1] }),
    issue(4, { dependsOn: [2] }),
    issue(5, { comments: [progress(3, "blocked")] }),
  ];
  const fixtureLsRemote = "aaa\trefs/heads/main\nbbb\trefs/heads/feat/5-x\n";
  const fixturePulls = [{ number: 9, headRefName: "feat/5-x", state: "OPEN" }];

  it("ファイルから読み、1行のJSONを出力して終了コード 0 を返す", () => {
    const paths = writeInputs(fixtureIssues, fixtureLsRemote, fixturePulls);
    const result = runCli(["--issues", paths.issues, "--branches", paths.branches, "--pulls", paths.pulls]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      '{"result":"RUN","issue":2,"role":"implementer","summary":"RUN #2 (implementer)","attention":[{"result":"WAIT_GATE","issue":3},{"result":"ESCALATE","issue":5}],"errors":[]}\n',
    );
  });

  it("同じ入力を2回与えると、同じ出力になる", () => {
    const paths = writeInputs(fixtureIssues, fixtureLsRemote, fixturePulls);
    const argv = ["--issues", paths.issues, "--branches", paths.branches, "--pulls", paths.pulls];

    const first = runCli(argv);
    const second = runCli(argv);

    expect(second).toEqual(first);
  });

  it("--issues - なら標準入力から読む", () => {
    const paths = writeInputs([], "", []);
    const result = runCli(["--issues", "-", "--branches", paths.branches, "--pulls", paths.pulls], () =>
      JSON.stringify(fixtureIssues),
    );

    expect(JSON.parse(result.stdout).summary).toBe("RUN #2 (implementer)");
  });

  it("ERROR なら終了コード 1", () => {
    const paths = writeInputs([issue(1, { dependsOn: [1] })], "", []);
    const result = runCli(["--issues", paths.issues, "--branches", paths.branches, "--pulls", paths.pulls]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).result).toBe("ERROR");
  });

  it("引数が足りなければ ERROR", () => {
    const result = runCli(["--issues", "x.json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).errors).toEqual(["--branches を指定してください", "--pulls を指定してください"]);
  });

  it("JSONとして読めなければ ERROR", () => {
    const paths = writeInputs([], "", []);
    writeFileSync(paths.issues, "{");
    const result = runCli(["--issues", paths.issues, "--branches", paths.branches, "--pulls", paths.pulls]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).errors[0]).toMatch(/^入力を読み込めません/);
  });
});
