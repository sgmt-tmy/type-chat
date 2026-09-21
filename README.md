# type-chat

軽量なチャットアプリ。ユーザーがグループを作成し、メッセージをやり取りできる。（認証は最小限）

> 現在は開発環境の整備段階。機能は今後追加する。

## 必要なもの
- Node.js（LTS）

## セットアップ
```bash
npm install
```

## Gitフックの有効化（クローン後に1回）
mainへの直接pushを防ぐフックを有効にする。この設定はコミットされないため、クローンするたびに実行する。
```bash
git config core.hooksPath .githooks
```
設定を確認するには、次を実行して `.githooks` と表示されればよい。
```bash
git config core.hooksPath
```

## 検証（テスト・Lint・型チェック）
```bash
npm run check
```

## ブランチ運用
mainへ直接pushしない。ブランチを切ってPRを作り、Actionsが緑になってからマージする。

## 環境変数
`.env.example` をコピーして `.env` を作る。`.env` はコミットしない。