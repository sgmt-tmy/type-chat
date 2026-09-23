# type-chat

軽量なチャットアプリ。ユーザーがグループを作成し、メッセージをやり取りできる。認証は最小限。
現在は開発環境の整備段階で、機能はこれから追加する。

## コマンド

```bash
npm run check   # lint + typecheck + test（これが通ることが完了の条件）
npm test        # テストのみ
```

## 構成

- `src/` … 実装とテスト（`*.test.ts` を同じ場所に置く）
- `.github/workflows/ci.yml` … PR時に `npm run check` を実行する

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
- `--no-verify` を使う。`core.hooksPath` を変更する
- force push、履歴の書き換え、ブランチの削除
- `.env` や鍵ファイルを読む・作る・コミットする
- 課金が発生する操作、リポジトリの公開範囲の変更