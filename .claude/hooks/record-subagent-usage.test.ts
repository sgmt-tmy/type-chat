import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TARGET_ROLES,
  USAGE_MARKER,
  buildUsageComment,
  findIssueRef,
  findPullRef,
  firstPrompt,
  issueFromPrBody,
  parseTranscript,
  recordUsage,
  runHook,
  summarizeUsage,
} from "./record-subagent-usage.js";

const hookPath = fileURLToPath(new URL("./record-subagent-usage.js", import.meta.url));
const TRANSCRIPT_PATH = "/tmp/session/subagents/agent-abc.jsonl";

type Call = { args: string[]; input?: string };

function line(entry: object): string {
  return JSON.stringify(entry);
}

function assistant(id: string, timestamp: string, usage: object, model = "claude-sonnet-5"): string {
  return line({ type: "assistant", timestamp, message: { id, model, usage } });
}

function transcript(prompt: string): string {
  return [
    line({ type: "user", timestamp: "2026-09-27T00:00:00.000Z", message: { role: "user", content: prompt } }),
    line({ type: "attachment", timestamp: "2026-09-27T00:00:00.100Z" }),
    // 1つの応答が複数行に分かれる。後の行ほど output_tokens が確定値に近い
    assistant("msg_1", "2026-09-27T00:00:05.000Z", {
      input_tokens: 2,
      output_tokens: 1,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 10,
    }),
    assistant("msg_1", "2026-09-27T00:00:06.000Z", {
      input_tokens: 2,
      output_tokens: 50,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 10,
    }),
    "{ 書きかけの行",
    assistant("msg_2", "2026-09-27T00:01:30.400Z", {
      input_tokens: 3,
      output_tokens: 20,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 0,
    }),
    assistant("msg_3", "2026-09-27T00:01:31.000Z", { input_tokens: 0, output_tokens: 0 }, "<synthetic>"),
    "",
  ].join("\n");
}

function payload(agentType: string, extra: object = {}): object {
  return {
    session_id: "session",
    transcript_path: "/tmp/session.jsonl",
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    agent_id: "abc",
    agent_type: agentType,
    agent_transcript_path: TRANSCRIPT_PATH,
    last_assistant_message: "完了しました",
    ...extra,
  };
}

function fakeDeps(prompt: string, prBody = "## 関連Issue\n\nCloses #79\n") {
  const calls: Call[] = [];
  const reads: string[] = [];
  return {
    calls,
    reads,
    deps: {
      readFile: (path: string) => {
        reads.push(path);
        return transcript(prompt);
      },
      runGh: (args: string[], input?: string) => {
        calls.push({ args, input });
        return args[0] === "pr" ? prBody : "https://github.com/sgmt-tmy/type-chat/issues/79#issuecomment-1\n";
      },
    },
  };
}

describe("summarizeUsage", () => {
  it("message.id ごとに最後の行の usage を合計し、所要時間とモデル名を出す", () => {
    const summary = summarizeUsage(parseTranscript(transcript("Issue #79 を実装してください")));
    expect(summary).toEqual({
      input_tokens: 5,
      output_tokens: 70,
      cache_read_tokens: 300,
      cache_creation_tokens: 10,
      duration_sec: 91,
      models: ["claude-sonnet-5"],
    });
  });

  it("空のトランスクリプトは0を返す", () => {
    expect(summarizeUsage([])).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      duration_sec: 0,
      models: [],
    });
  });
});

describe("書き込み先の特定", () => {
  it("依頼文の最初の Issue 参照を読む", () => {
    expect(findIssueRef("ハーネスタスク Issue #79（https://github.com/x/y/issues/79）。Issue #51 も参照")).toBe(79);
    expect(findIssueRef("https://github.com/x/y/issues/12 を計画してください。Issue #5")).toBe(12);
    expect(findIssueRef("参照なし #3")).toBeUndefined();
  });

  it("依頼文の最初の PR 参照を読む", () => {
    expect(findPullRef("PR #78（Issue #74 の実装）をレビューして")).toBe(78);
    expect(findPullRef("https://github.com/x/y/pull/80 をレビュー")).toBe(80);
    expect(findPullRef("Issue #74")).toBeUndefined();
  });

  it("PR本文の Closes 行から Issue 番号を読む", () => {
    expect(issueFromPrBody("## 関連Issue\n\nCloses #79\n\n## 変更内容")).toBe(79);
    expect(issueFromPrBody("Closes #79 と #80")).toBeUndefined();
    expect(issueFromPrBody("")).toBeUndefined();
  });

  it("最初のユーザーメッセージを依頼文として読む（配列形式にも対応）", () => {
    const entries = [
      { type: "user", isMeta: true, message: { content: "meta" } },
      { type: "user", message: { content: [{ type: "text", text: "Issue #9" }] } },
    ];
    expect(firstPrompt(entries)).toBe("Issue #9");
  });
});

describe("buildUsageComment", () => {
  it("1行目がマーカーで、使用量だけを yaml で書く（依頼文を含めない）", () => {
    const summary = summarizeUsage(parseTranscript(transcript("秘密の依頼文 Issue #79")));
    const body = buildUsageComment("implementer", "abc", summary);
    expect(body.split("\n")[0]).toBe(USAGE_MARKER);
    expect(body).toContain("role: implementer\n");
    expect(body).toContain("agent_id: abc\n");
    expect(body).toContain("models: [claude-sonnet-5]\n");
    expect(body).toContain("input_tokens: 5\n");
    expect(body).toContain("output_tokens: 70\n");
    expect(body).toContain("cache_read_tokens: 300\n");
    expect(body).toContain("cache_creation_tokens: 10\n");
    expect(body).toContain("duration_sec: 91\n");
    expect(body).not.toContain("秘密の依頼文");
    expect(body).not.toContain("@" + "claude");
  });
});

describe("recordUsage", () => {
  it("対象ロールは planner・implementer・spec-reviewer の3つ", () => {
    expect(TARGET_ROLES).toEqual(["planner", "implementer", "spec-reviewer"]);
  });

  it("implementer はタスクのIssueにコメントする", () => {
    const { calls, reads, deps } = fakeDeps("ハーネスタスク Issue #79 を実装してください");
    expect(recordUsage(payload("implementer"), deps)).toEqual({ posted: true, issue: 79 });
    expect(reads).toEqual([TRANSCRIPT_PATH]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["issue", "comment", "79", "--body-file", "-"]);
    expect(calls[0].input?.startsWith(`${USAGE_MARKER}\n`)).toBe(true);
    expect(calls[0].input).toContain("role: implementer\n");
  });

  it("planner は依頼文の親Issueにコメントする", () => {
    const { calls, deps } = fakeDeps("親Issue #60（harness-epic）をタスクに分解してください");
    expect(recordUsage(payload("planner"), deps)).toEqual({ posted: true, issue: 60 });
    expect(calls[0].args).toEqual(["issue", "comment", "60", "--body-file", "-"]);
  });

  it("spec-reviewer はPRの Closes 行のIssueにコメントする", () => {
    const { calls, deps } = fakeDeps("PR #80 をレビューしてください（Issue #1 は無関係）");
    expect(recordUsage(payload("spec-reviewer"), deps)).toEqual({ posted: true, issue: 79 });
    expect(calls[0].args).toEqual(["pr", "view", "80", "--json", "body", "--jq", ".body"]);
    expect(calls[1].args).toEqual(["issue", "comment", "79", "--body-file", "-"]);
  });

  it("対象外のロール（verifier など）は何もしない", () => {
    const { calls, reads, deps } = fakeDeps("PR #80 を確認");
    expect(recordUsage(payload("verifier"), deps).posted).toBe(false);
    expect(recordUsage(payload("general-purpose"), deps).posted).toBe(false);
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("書き込み先を特定できなければコメントしない", () => {
    const { calls, deps } = fakeDeps("要求をタスクに分解してください");
    expect(recordUsage(payload("planner"), deps)).toEqual({
      posted: false,
      reason: "書き込み先のIssueを特定できない",
    });
    expect(calls).toEqual([]);
  });

  it("spec-reviewer でPR本文に Closes 行がなければコメントしない", () => {
    const { calls, deps } = fakeDeps("PR #80 をレビュー", "本文なし");
    expect(recordUsage(payload("spec-reviewer"), deps).posted).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("agent_transcript_path がなければ何もしない", () => {
    const { calls, deps } = fakeDeps("Issue #79");
    expect(recordUsage(payload("implementer", { agent_transcript_path: undefined }), deps).posted).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("runHook（失敗してもブロックしない）", () => {
  it("gh が失敗しても終了コード0で、理由を標準エラーに出す", () => {
    const deps = {
      readFile: () => transcript("Issue #79"),
      runGh: () => {
        throw new Error("gh: HTTP 502");
      },
    };
    const result = runHook(JSON.stringify(payload("implementer")), deps);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("gh: HTTP 502");
  });

  it("トランスクリプトが読めなくても終了コード0", () => {
    const deps = {
      readFile: () => {
        throw new Error("ENOENT");
      },
      runGh: () => "",
    };
    const result = runHook(JSON.stringify(payload("implementer")), deps);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("ENOENT");
  });

  it("入力が JSON でなくても終了コード0", () => {
    expect(runHook("not json").code).toBe(0);
  });

  it("スクリプトとして実行しても、不正な入力や対象外のロールで終了コード0", () => {
    const invalid = spawnSync("node", [hookPath], { input: "not json", encoding: "utf-8" });
    expect(invalid.status).toBe(0);
    const other = spawnSync("node", [hookPath], {
      input: JSON.stringify(payload("verifier")),
      encoding: "utf-8",
    });
    expect(other.status).toBe(0);
    expect(other.stderr).toBe("");
  });
});
