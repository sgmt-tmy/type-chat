---
name: ハーネスタスク
about: 自律運用ハーネスが扱うタスク（規約は .claude/harness/conventions.md）
labels: harness
---

<!--
タイトルは「[harness] T<番号> <やること>」にする。
メタデータブロックを書き換えたら、ラベルも合わせる（gate: true なら gate、risk に対応する risk:* ）。
タイトル・本文に @ + claude のメンション文字列を書かない（claude.yml が起動する）。
-->

## 背景・目的

## やること
- [ ]

## 受け入れ条件（機械判定）
- [ ]
- [ ] `npm run check` が通る

## 人が判断すること
<!-- gate: true のときだけ書く。gateの理由と、人に決めてほしい選択肢（推奨案つき）。gate: false なら「なし」 -->
なし

## ハーネスメタデータ
<!--
書式は .claude/harness/conventions.md の「メタデータブロック」を参照。ブロック内にコメントは書けない。
- id: T<数字>
- depends_on: [#<Issue番号>, ...]（依存関係の正本。なければ []）
- gate: true / false
- gate_reasons: irreversible / spec_ambiguity / failure_threshold / risk_cost / security_boundary から選ぶ（gate: false なら []）
- risk: low / medium / high
- max_attempts: 1以上の整数
-->
```yaml
id: T0
depends_on: []
gate: false
gate_reasons: []
risk: low
max_attempts: 3
```

## 依存
<!-- depends_on の各Issueと、何に依存しているか。なければ「なし」 -->
なし
