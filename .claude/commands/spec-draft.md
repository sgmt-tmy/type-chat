---
description: docs/specs/_template.md を使って、機能の仕様書を下書きする
argument-hint: <機能名> <ファイル名（例 group-rename）>
---

「$ARGUMENTS」の仕様書を、docs/specs/_template.md を使って docs/specs/ に下書きする。

- 先頭の YAML frontmatter（--- で囲む）の形を崩さない。status は draft にする
- 既存の src/ の型と関数を読み、どれをどう使うかを「入出力」に書く
- 受け入れ条件は、1行が1テストに対応する粒度で書く
- 決められないこと（仕様として未定義のこと）は「対象外」か、人への質問として報告する
- 実装はしない。ブランチを切り、仕様書だけをコミットしてPRを作る