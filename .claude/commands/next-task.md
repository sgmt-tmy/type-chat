---
description: ハーネスのタスクDAGから次のタスクを1つ選び、Implementerを呼ぶか、止まって報告する
---

自律運用ハーネスのオーケストレーターとして、次に実行するタスクを `scripts/harness/next-task.js` で1つ決め、その結果に従って動く。1回の実行で扱うタスクは1つだけ。ループしない。

参照する規約: `CLAUDE.md`、`.claude/harness/conventions.md`（メタデータ・gate承認・ブランチとPR・progressスナップショット）。判定の順番と優先順位は Issue #53（T9）の「実装前の確認」への回答。

## 1. 入力を集めて判定する

一時ディレクトリ（`mktemp -d`）を作り、次の3つを保存してからスクリプトを実行する。判定は必ずスクリプトの出力に従い、自分で判定し直さない。

```bash
gh issue list --label harness --state all --limit 1000 --json number,title,body,labels,state,comments > "$DIR/issues.json"
git ls-remote --heads origin > "$DIR/branches.txt"
gh pr list --state all --limit 1000 --json number,headRefName,state > "$DIR/pulls.json"
node scripts/harness/next-task.js --issues "$DIR/issues.json" --branches "$DIR/branches.txt" --pulls "$DIR/pulls.json"
```

出力は1行のJSON（`{"result", "issue", "role", "summary", "attention", "errors"}`）。終了コードは判定できたら 0、`ERROR` なら 1。

### 検証モード（`harness-dryrun`）

ハーネスの通しの検証（ドライラン）のときだけ使う。追加の経緯は Issue #67（T12）。

- `harness-dryrun` ラベルは、検証のために作ったタスクIssueの印。`harness` ラベルと一緒に付ける（`gh issue list --label harness` で集めるため）。
- 検証モードは、スクリプトに `--dryrun` を付けて有効にする。有効にすると、`harness-dryrun` ラベルの付いた open の Issue だけが選定の対象になる（通常のタスクは選ばない）。

```bash
node scripts/harness/next-task.js --issues "$DIR/issues.json" --branches "$DIR/branches.txt" --pulls "$DIR/pulls.json" --dryrun
```

- `--dryrun` を付けない通常の実行では、`harness-dryrun` ラベルの付いた Issue は選定の対象にならない（`RUN` / `WAIT_GATE` / `ESCALATE` にも、`attention` にも、メタデータ不正の `ERROR` にも出ない）。
- どちらのモードでも、対象外の Issue は `depends_on` の参照先としては使う（検証用のタスクが通常のタスクに依存してよい）。
- `--dryrun` は、人から検証を頼まれたときだけ付ける。通常の `/next-task` では付けない。

## 2. 結果に応じて動く

| `result` | すること |
| --- | --- |
| `RUN` | `role`（今は常に `implementer`）のサブエージェントを、Issue `#<issue>` を渡して1回呼ぶ。PRができたら、そのPR番号を渡して `verifier` を1回呼ぶ。PRができていれば `TASK_DONE` を通知する（下の「3. 人に通知する」）。両方の結果を報告して止まる |
| `WAIT_GATE` | `WAIT_GATE` を通知して止まる。Issue `#<issue>` が gate の承認待ち（`## gate承認` コメントと `gate:approved` ラベル）であることを報告する |
| `ESCALATE` | `ESCALATE` を通知して止まる。Issue `#<issue>` の試行回数が `max_attempts` に達したことと、最新のprogressスナップショットの `last_failure` を報告する |
| `BLOCKED` | 止まる。open のタスクが、依存の完了待ちか着手済み（作業中・レビュー待ち・人の判断待ち）しかないことを報告する |
| `DONE` | 止まる。open のタスクがないことを報告する |
| `ERROR` | 止まる。`errors` をそのまま報告する（循環依存・メタデータ不正・ラベルとの食い違い・同じ番号のブランチが2本以上など） |

- どの結果でも、`attention` に並んだタスク（ほかの `WAIT_GATE` / `ESCALATE`）を報告に含める。
- 報告の最初の行は、スクリプトの `summary`（例: `RUN #53 (implementer)`）にする。

## 3. 人に通知する

`scripts/harness/notify.js` で、該当Issueにコメント（止まったときは `gate:waiting` ラベルも）を付け、GitHub標準の通知で人に知らせる。通知の手段と再開の手順は `.claude/harness/conventions.md` の「通知と再開」。

```bash
node scripts/harness/notify.js --event WAIT_GATE --issue <issue>
node scripts/harness/notify.js --event ESCALATE --issue <issue>
node scripts/harness/notify.js --event TASK_DONE --issue <issue> --pr <PR番号>
```

- 通知するのは、2. の結果で選ばれた1つのIssueだけ。`attention` のタスクには通知しない（それぞれが選ばれたときに通知する）。
- 出力は1行のJSON（`{"sent", "skipped", "actions", "errors"}`）。`skipped: true` は送信済み（同じ通知がすでにある）という意味で、失敗ではない。
- 終了コードが 1 なら、`errors` を報告に含める。通知を送り直すために別の手段（`gh api` など）は使わない。

## 禁止事項

- 2つ以上のタスクに手を付ける。`RUN` の後に、もう一度スクリプトを実行して次のタスクへ進まない。
- 着手済みのタスクを再開する（再開は人が判断する）。
- 自分でファイルを変更する、ブランチ・PRを作る（作業は Implementer だけが行う）。
- `gate:approved` ラベルを付ける・外す、`## gate承認` コメントを書く、PRをマージする。
- Issue・PR・コメントに、`@` + `claude` のメンション文字列を書く。
- `CLAUDE.md` の「やってはいけないこと」と `.claude/settings.json` の deny に当たる操作。
