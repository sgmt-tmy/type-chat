## 概要
<!-- 何を、なぜ変更したか -->

## 関連Issue
<!--
Closes #<Issue番号> を1行だけ書く。番号はブランチ名（feat/<Issue番号>-<slug>）の番号と一致させる。
規約は .claude/harness/conventions.md の「ブランチとPR」を参照。
-->
Closes #

## gate判定結果
<!--
書式は .claude/harness/conventions.md の「gate判定結果ブロック」を参照。ブロック内にコメントは書けない。
- task_gate: Issueのメタデータの gate（メタデータがないIssueは、gate ラベルがあれば true）
- approved: PRを作った時点で、Issueに gate:approved ラベルが付いているか
- diff_check: not_run / pass / gate（判定スクリプト（T5）ができるまでは常に not_run）
- diff_rules: diff_check: gate のとき、判定スクリプトの出力の reasons[].rule。それ以外は []
task_gate: false で diff_check: gate になるなら、PRを作らずに人に上げる。
手作業で気づいた点があれば、ブロックの下に文章で書く。
-->
```yaml
task_gate: false
approved: false
diff_check: not_run
diff_rules: []
```

## 関連する仕様書
<!-- docs/specs/・docs/decisions/ 配下の関連ファイルへのリンク（なければ「なし」） -->

## 変更点
-

## 確認方法
<!-- レビュアーが動作確認する手順 -->

## チェックリスト
- [ ] `npm run check`（テスト・Lint・型チェック）がローカルで通っている
- [ ] GitHub Actionsが**緑**であることを確認した（マージ前）
- [ ] 認証情報・`.env` を含んでいない
- [ ] 人が判断すべき変更（課金・破壊的操作・公開）を含む場合、その判断を記載した
