# type-chat

軽量なチャットアプリ。ユーザーがグループを作成し、メッセージをやり取りできる。認証は最小限。
現在は開発環境の整備段階で、機能はこれから追加する。

## コマンド

```bash
npm run check       # lint + typecheck + 仕様書の形式チェック + test（これが通ることが完了の条件）
npm run check:specs # docs/specs/ の仕様書の形式チェックのみ
npm test            # テストのみ
npm run setup:hooks # Gitフック（main保護）を有効化する。クローン直後に1回実行する
```

## 構成

- `src/` … 実装とテスト（`*.test.ts` を同じ場所に置く）
- `.github/workflows/ci.yml` … PR時と `main` へのpush時に `npm run check` を実行する

セットアップ手順は README.md を参照。

## 規約

- TypeScript の strict モードを維持する（`any` を足さない）
- 実装を変更したら、同じPRでテストも足す
- 変更は小さく保つ。1つのPRで1つのことだけを行う

## 作業の進め方

1. `main` から作業ブランチを切る（`feat/xxx`、`fix/xxx`）
2. 実装とテストを書く
3. `npm run check` を実行し、**通るまで自分で直す**
4. コミットし、push する
5. PRを作る（`.github/PULL_REQUEST_TEMPLATE.md` の項目を必ずすべて埋める。push・PR作成は確認なしで進めてよいが、テンプレートの記入は省略しない）

## やってはいけないこと

- `main` へ直接pushする
- PRをマージする（人が行う）
- `--no-verify` を使う
- 生の `git config core.hooksPath` を実行する（有効化は `npm run setup:hooks` を使う。直接コマンドは値を問わず禁止）
- force push、履歴の書き換え、ブランチの削除
- `.env` や鍵ファイルを読む・作る・コミットする
- 課金が発生する操作、リポジトリの公開範囲の変更

## 実装依頼のデフォルト方針

進め方の指示がない実装依頼は、以下を既定動作とする：
関連する仕様書（`docs/specs/`・`docs/decisions/`）を読む → ブランチを切る → 実装とテストを書く → `npm run check` が通るまで直す → push → PR作成（テンプレートの項目を埋める）→ URLを報告。

ただし、依頼文で「PRは作らず、コミットまでにして」のように範囲が明示された場合はそれに従う。

## 仕様と設計判断

- 仕様書は `docs/specs/`、設計判断（ADR）は `docs/decisions/` にある。書き方は `docs/README.md` を参照
- 機能の実装・変更の前に、関係する仕様書を読む。受け入れ条件をテストにする
- 仕様と食い違う変更が必要なら、実装する前に報告する。変更する場合は同じPRで仕様書も更新する
- 該当する仕様書がない機能追加は、実装せずに仕様の下書きから始めるか確認する