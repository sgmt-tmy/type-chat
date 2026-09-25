# ハーネスの状態層の規約

自律運用ハーネスが「今どこにいるか」を、会話履歴に頼らずGitHub上に残すための規約。
オーケストレーター・各役のエージェント・人は、この規約を前提に動く。

決定の経緯: Issue #45（T1）のgate承認コメント（2026-09-26）。

## 置き場所

| 対象 | 置き場所 |
| --- | --- |
| ハーネスの規約・設定 | `.claude/harness/`（このファイル） |
| ハーネスのスクリプトとテスト | `scripts/harness/`（既存の `scripts/check-specs.js` と同じく、`npm run check` の対象になる場所） |
| ハーネスタスクのIssueテンプレート | `.github/ISSUE_TEMPLATE/harness-task.md` |
| progressスナップショット | 該当Issueへのコメント（後述） |

- `docs/` には置かない。`docs/` はアプリの文書（仕様書・アプリのADR）の場所で、ハーネスはアプリの仕様ではないため（`docs/README.md` の区分を維持する）。

## タスクIssue

- ハーネスが扱うタスクは、1タスク＝1 Issue。`.github/ISSUE_TEMPLATE/harness-task.md` から作る。
- タイトルは `[harness] T<番号> <やること>` にする。
- 本文に「メタデータブロック」を1つだけ置く。
- タイトル・本文に `@` + `claude` のメンション文字列を書かない（`.github/workflows/claude.yml` が起動し、利用枠を消費する）。

## メタデータブロック

本文の `## ハーネスメタデータ` 見出しのセクション（次の見出しまで）にある、最初の ```` ```yaml ```` ブロック。

````markdown
## ハーネスメタデータ
```yaml
id: T9
depends_on: [#45, #47, #48]
gate: false
gate_reasons: []
risk: medium
max_attempts: 3
```
````

### 必須キー

6つすべて必須。これ以外のキーは書かない（書くとパースエラーになる）。

| キー | 値 | 意味 |
| --- | --- | --- |
| `id` | `T<数字>` | タスクの識別子。Issue番号とは別で、計画（親Issue）の中での番号 |
| `depends_on` | `[#<Issue番号>, ...]`（なければ `[]`） | 先に closed になっている必要があるIssue。**依存関係の正本** |
| `gate` | `true` / `false` | `true` なら、人の承認なしに着手・反映しない |
| `gate_reasons` | 下の5区分のリスト | gateが必要な理由。`gate: true` なら1つ以上、`gate: false` なら `[]` |
| `risk` | `low` / `medium` / `high` | リスク区分 |
| `max_attempts` | 1以上の整数 | 試行回数の上限。progressスナップショットの `attempt` がこれに達したら、自動では再試行せず人に上げる |

`gate_reasons` の5区分:

| 値 | 意味 |
| --- | --- |
| `irreversible` | 取り消せない操作を含む |
| `spec_ambiguity` | 仕様が曖昧で、人が決める必要がある |
| `failure_threshold` | 失敗が閾値を超えた（試行回数の上限到達など） |
| `risk_cost` | リスクやコスト（課金・利用枠）が大きい |
| `security_boundary` | 権限・認証情報・エージェントが従うルールなど、セキュリティ境界に触れる |

各区分の具体的な判定基準は T3（#47）で決める。

### 書き方の制約

- 1行に `key: value` を1つ。リストはインライン形式（`[a, b]`）だけを使う。
- ブロック内にコメントは書けない（`#45` の `#` と区別できないため）。説明はブロックの外にHTMLコメントで書く。
- パーサは `scripts/harness/metadata.js` の `parseHarnessMetadata`。書式を変えるときは、パーサ・テスト・テンプレート・この規約を同じPRで直す。

### 依存関係の正本

- `depends_on` を正本とする。GitHub標準のIssue依存関係（blocked by）は表示用にとどめる。
- 両者が食い違ったら `depends_on` に従い、標準機能の側を直す。

## ラベル

| ラベル | 意味 | 付ける人 |
| --- | --- | --- |
| `harness` | ハーネスのタスク。オーケストレーターの対象 | Issueを作る人・AI |
| `harness-epic` | ハーネスの親Issue（計画）。オーケストレーターの対象外。`harness` と同時に付けない | Issueを作る人・AI |
| `gate` | メタデータが `gate: true` であることの写し | Issueを作る人・AI |
| `risk:low` / `risk:medium` / `risk:high` | メタデータの `risk` の写し。1つだけ付ける | Issueを作る人・AI |
| `gate:approved` | gateを人が承認した（後述） | **人だけ** |

- `gate` と `risk:*` はメタデータの写しで、正本はメタデータ。食い違ったら、メタデータ不正として扱い、自動では進めない。
- メタデータを書き換えたら、同時にラベルも合わせる。

## gate承認の表明方法

`gate: true` のタスクは、人が次の2つを行ったときに承認されたとみなす。

1. Issueに `## gate承認` で始まるコメントを書き、「人が判断すること」の各項目への判断を記す（推奨案どおりなら、その旨を書く）。
2. Issueに `gate:approved` ラベルを付ける。

- 機械的な判定（オーケストレーター）は `gate:approved` ラベルの有無で行う。コメントは判断内容の記録。
- AIは `gate:approved` ラベルを付けない・外さない。承認コメントも書かない。
- 承認は着手の許可であり、PRのマージは別に人が行う。
- 承認後に判断を変える場合は、人が新しい `## gate承認` コメントを書く。最新のコメントを正とする。

## progressスナップショット

タスクの進み具合を、該当Issueへのコメントとして残す。ブランチが消えても残り、`main` を汚さないため。

### 書くタイミング

- 着手したとき（試行の開始）
- 試行が失敗したとき、止まったとき（人に上げるときを含む）
- PRを作ったとき

### 書式

1行目にマーカー `<!-- harness:progress -->` を置く。マーカーの付いたコメントのうち、**最新のものを正**とする。
過去のスナップショットは編集・削除しない（追記のみ。経緯として残す）。

````markdown
<!-- harness:progress -->
## progressスナップショット
```yaml
attempt: 2
status: failed
branch: feat/45-harness-state-layer
pr: none
last_failure: npm run check の typecheck で失敗（src/group.ts の型エラー）
```

### 進捗
- [x] パーサを追加
- [ ] テンプレートを追加
````

| キー | 値 | 意味 |
| --- | --- | --- |
| `attempt` | 1以上の整数 | 何回目の試行か。着手するたびに1増やす。`max_attempts` に達したら、それ以上自動で試行しない |
| `status` | `in_progress` / `failed` / `blocked` / `pr_open` | `in_progress`: 作業中／`failed`: この試行が失敗した／`blocked`: 人の判断待ちで止まった／`pr_open`: PRを作り、レビュー・マージ待ち |
| `branch` | ブランチ名、または `none` | 作業ブランチ |
| `pr` | `#<PR番号>`、または `none` | 作ったPR |
| `last_failure` | 1行の文、または `none` | 最後の失敗の理由。`failed` / `blocked` のときは必ず書く |

- 進捗は `### 進捗` 以下にチェックリストで書く（Issueの「やること」に対応させる）。
- タスクの完了はIssueが closed になったことで判定する。スナップショットに完了状態は持たせない。
