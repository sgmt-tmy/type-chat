---
status: draft        # draft / approved / implemented / deprecated
updated: 2026-09-28
---

# UIの土台（画面構成・UI規約・土台の部品）

## 目的

Next.js（App Router）・Tailwind CSS・shadcn/ui の土台と、全画面に共通のUI/UX方針を決める（ADR 0001、親Issue #133）。
方針「モダンなデザイン」「シンプルで直感的な操作」「ユーザーファースト」は主観的な言葉のままでは判定できないため、この仕様で機械判定できる規約に翻訳する。各画面の仕様（文言・導線の詳細）は、この仕様の規約を前提に書く。

## 入出力

### 画面一覧と導線

| パス | 画面 | 内容 | 詳細の仕様 |
| --- | --- | --- | --- |
| `/start` | 利用開始 | 名前を入れて利用を始める。既存の利用者を選んで入り直す | `docs/specs/web-api-foundation.md` |
| `/` | ホーム | 自分のグループ一覧と、グループの作成 | `docs/specs/web-groups.md` |
| `/groups/[groupId]` | チャット | メッセージの一覧と投稿 | `docs/specs/web-chat.md` |
| `/groups/[groupId]/settings` | グループ設定 | グループ名・メンバー・脱退／削除 | `docs/specs/group-settings.md` ほか |

導線:

- 全画面の共通ヘッダーのアプリ名は、ホーム（`/`）へのリンクにする。
- チャット画面（`/groups/[groupId]`）の画面上部に、「戻る（ホーム）」（`/` へのリンク）と「設定」（`/groups/[groupId]/settings` へのリンク）を置く。
- グループ設定画面（`/groups/[groupId]/settings`）に、「チャットに戻る」（`/groups/[groupId]` へのリンク）を置く。
- グループの作成からチャットの開始までは、ホームでグループ名を入力し、作成ボタンを1回押すだけで到達できる（作成に成功したら、そのグループの `/groups/[groupId]` へ移動する）。途中に確認や別の画面を挟まない。

### 見た目の一貫性（「モダンなデザイン」の翻訳）

- **色はテーマトークンだけを使う。** shadcn/ui のテーマトークンのクラス（`bg-background`・`text-foreground`・`bg-primary`・`text-primary-foreground`・`bg-muted`・`text-muted-foreground`・`bg-accent`・`border-border`・`text-destructive` など）を使う。トークンの値は `src/app/globals.css` の CSS 変数で定義する。
- **Tailwind の生の色クラスを使わない。** 既定パレットの色名（`slate`・`gray`・`zinc`・`neutral`・`stone`・`red`・`orange`・`amber`・`yellow`・`lime`・`green`・`emerald`・`teal`・`cyan`・`sky`・`blue`・`indigo`・`violet`・`purple`・`fuchsia`・`pink`・`rose`）と濃さ（`50`〜`950`）を組み合わせたクラス（例: `bg-blue-500`・`text-gray-600`・`border-red-200`・`hover:bg-blue-600`）と、`black`・`white` の色クラス（例: `text-white`・`bg-black`）が対象。`transparent`・`current`・`inherit` は使ってよい。
- **任意値を使わない。** ユーティリティ名の後に `-[`〜`]` が続くクラス（例: `p-[13px]`・`w-[320px]`・`bg-[#1e40af]`・`text-[15px]`）が対象。`data-[state=open]:` のような任意のバリアントも同じ形なので対象に含める（必要な場合は `src/components/ui/` の部品の側で扱う）。
- 上の2つ（生の色クラス・任意値）を禁止する範囲は、`src/app/`・`src/components/` の `.tsx`。ただし `src/components/ui/`（shadcn/ui が生成する部品）は除く。
- **本文の幅は共通レイアウトで揃える。** `src/app/layout.tsx` の `main` 要素に `mx-auto max-w-2xl px-4` を付け、各画面は自分で最大幅（`max-w-*`）を指定しない。
- **各画面の見出し（`h1`）は1つだけ。** 共通ヘッダーのアプリ名は `h1` にしない（画面の `h1` と重ならないように）。

### 操作を絞る（「シンプルで直感的な操作」の翻訳）

- **1画面の主操作は1つまで。** 主操作とは `variant="default"` のボタン（`variant` を指定しない `Button` を含む）。それ以外の操作は `secondary`・`outline`・`ghost`・`link`・`destructive` のボタンかリンクにする。
- **確認ダイアログを出すのは、取り消せない操作だけ。** 対象は次の4つに限る。
  - メッセージの削除
  - オーナーの委譲
  - グループからの脱退
  - グループの削除
- 上の4つ以外の操作（グループの作成・グループ名の変更・メンバーの追加・メッセージの投稿など）は、確認なしで即時に反映する。
- **設定項目を増やさない。** 利用者ごとの表示設定（テーマの切り替え・通知の設定など）は作らない。ダークモードの切り替えも提供しない（`globals.css` の `.dark` のトークンは shadcn/ui の初期化のまま残してよい）。

### フィードバック（「ユーザーファースト」の翻訳）

- **成功はトーストで知らせる。** sonner の `toast.success` で、文言は「〜しました」（例: 「グループを作成しました」「グループ名を変更しました」）。ただしメッセージの投稿は、一覧に表示されることを成功のフィードバックとし、トーストを出さない（投稿のたびにトーストが出ると邪魔になるため）。
- **入力エラーは入力欄の直下に出す。** 文言は入力欄のすぐ下に `text-destructive` の小さい文字で出し、入力欄に `aria-invalid="true"` を付け、`aria-describedby` でその文言の要素を指す。対象は、送信前の検査（空・文字数超過など）と、APIが返したエラーのうち入力値に原因があるもの（`code` が `validation`・`conflict`）。
- **サーバーのエラーはトーストで出す。** 上の入力エラー以外のAPIのエラー（`forbidden`・`not_found`・`unauthenticated`・想定外のエラー・通信エラー）は、APIが返す `message` を `toast.error` で出す。内部の詳細を画面で組み立てない。
- **送信中はボタンを無効にする。** 送信が終わるまで送信ボタンを `disabled` にし、ラベルを「〜中…」にする（例: 「作成」→「作成中…」、「削除する」→「削除中…」）。二重送信を防ぐ。
- **読み込み中は Skeleton を出す。** データの取得が終わるまで、表示される内容の形に合わせた `Skeleton` を出す。スピナーや「読み込み中…」の文字だけの表示は使わない。
- **空状態は「何がないか」と「次にできる操作」を出す。** 一覧が空のときは `EmptyState` で、何がないか（例: 「まだグループがありません」）と、次にできる操作（ボタンかリンク）を出す。
- **ポーリングしない。** 画面を最新に保つのは SSE（ADR 0001）で行い、定期的な再取得（`setInterval` など）は使わない。

### アクセシビリティ

- すべての入力欄にラベルを付ける。見えるラベル（`Label` の `htmlFor`）か、見えないラベル（`sr-only` のクラスを付けた `Label`）のどちらか。
- アイコンだけのボタン・リンクには `aria-label` を付ける（例: 「ホームに戻る」「メッセージの操作」）。
- キーボードだけで主要な操作ができる。クリックできる要素は `button` か `a`（Next.js の `Link`）にし、`div` などに `onClick` を付けない。フォームは `form` 要素にし、Enter キーで送信できるようにする。フォーカスの表示（shadcn/ui の `focus-visible` のスタイル）を消さない。

### 土台のファイル

| ファイル | 内容 |
| --- | --- |
| `src/app/layout.tsx` | ルートレイアウト。`html` 要素に `lang="ja"`。`body` の中に、共通ヘッダー（`AppHeader`）、本文の共通レイアウト（`main` 要素、`mx-auto max-w-2xl px-4`）、トーストの表示領域（`Toaster`）を置く。`metadata` の `title` は `type-chat`。共通ヘッダー・共通レイアウト・`Toaster` は「共通部品と規約テスト」の段階で置く（土台の段階では `lang="ja"` の `html` と `body` だけでよい） |
| `src/app/globals.css` | Tailwind CSS の読み込みと、shadcn/ui のテーマトークン（`--background`・`--foreground`・`--primary`・`--primary-foreground`・`--muted`・`--muted-foreground`・`--accent`・`--destructive`・`--border`・`--input`・`--ring` など）の CSS 変数 |
| `src/app/page.tsx` | 土台の段階では仮のページ（`h1` を1つだけ描画する）。ホーム画面は `docs/specs/web-groups.md` で置き換える |
| `src/lib/utils.ts` | shadcn/ui の `cn(...inputs)`（`clsx` で結合し、`tailwind-merge` で衝突するクラスを後勝ちにまとめる） |
| `components.json` | shadcn/ui の設定。`tsx: true`・`rsc: true`、エイリアスは `components` → `@/components`、`ui` → `@/components/ui`、`utils` → `@/lib/utils`、`lib` → `@/lib`、アイコンは `lucide` |

`tsconfig.json` は `strict: true` を維持し、`@/*` を `src/*` へのエイリアスにする。

shadcn/ui の部品（`src/components/ui/`、shadcn/ui の CLI で追加し、手では書き換えない）:

| ファイル | 主な用途 |
| --- | --- |
| `src/components/ui/button.tsx` | ボタン（主操作は `default`、破壊的操作は `destructive`） |
| `src/components/ui/input.tsx` | 1行の入力欄（グループ名・利用者名など） |
| `src/components/ui/textarea.tsx` | メッセージの入力欄 |
| `src/components/ui/label.tsx` | 入力欄のラベル |
| `src/components/ui/card.tsx` | グループ一覧・設定の区画 |
| `src/components/ui/alert-dialog.tsx` | 確認ダイアログ（`ConfirmDialog` の中身） |
| `src/components/ui/dropdown-menu.tsx` | 利用者メニュー・メッセージの操作メニュー |
| `src/components/ui/select.tsx` | オーナーの委譲先などの選択 |
| `src/components/ui/sonner.tsx` | トーストの表示領域（`Toaster`） |
| `src/components/ui/badge.tsx` | 「オーナー」などの表示 |
| `src/components/ui/skeleton.tsx` | 読み込み中の表示 |
| `src/components/ui/separator.tsx` | 区切り線 |

### 共通部品

#### `src/components/app-header.tsx`

```tsx
export function AppHeader(): React.JSX.Element;
```

- `header` 要素（`banner` ロール）の中に、アプリ名「type-chat」を `/` へのリンクとして描画する。アプリ名は `h1` にしない。
- 右端は、利用者メニューを置く場所として空けておく（利用者メニューの追加は `docs/specs/web-api-foundation.md` で行う）。

#### `src/components/empty-state.tsx`

```tsx
export type EmptyStateProps = {
  title: string;        // 何がないか（例: 「まだグループがありません」）
  description: string;  // 補足（例: 「グループを作成して、メッセージのやり取りを始めましょう」）
  action: React.ReactNode;  // 次にできる操作（ボタンかリンク）
};

export function EmptyState(props: EmptyStateProps): React.JSX.Element;
```

- `title` は `h2`、`description` は `text-muted-foreground` の段落、その下に `action` を描画する。
- `action` は必須（「次にできる操作」のない空状態を作らない）。

#### `src/components/confirm-dialog.tsx`

```tsx
export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;          // 例: 「グループを削除しますか？」
  description: string;    // 例: 「メッセージもすべて削除され、元に戻せません。」
  confirmLabel: string;   // 確定ボタンの文言（例: 「削除する」）
  pendingLabel: string;   // 確定中の文言（例: 「削除中…」）
  destructive?: boolean;  // true なら確定ボタンを destructive の見た目にする（既定は false）
  pending?: boolean;      // true の間は確定中（既定は false）
  onConfirm: () => void;
};

export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element;
```

- shadcn/ui の `AlertDialog` を包む。開閉は呼び出し側が `open`・`onOpenChange` で制御する。
- `open` が `true` のとき、`alertdialog` ロールの要素にタイトルと説明、「キャンセル」ボタンと確定ボタンを描画する。
- 確定ボタンを押すと `onConfirm` を呼ぶ。ダイアログは自動では閉じない（呼び出し側が、処理に成功したら `open` を `false` にし、失敗したらエラーのトーストを出して開いたままにする）。
- 「キャンセル」を押すと `onOpenChange(false)` を呼び、`onConfirm` は呼ばない。
- `pending` が `true` の間は、確定ボタンと「キャンセル」を `disabled` にし、確定ボタンの文言を `pendingLabel` にする。
- `destructive` が `true` のとき、確定ボタンを `Button` の `variant="destructive"` の見た目にする。

### 規約テスト（`src/components/ui-conventions.test.ts`）

UI規約のうち機械判定できるものを、以後の画面の追加でも自動で検査する。

- **走査対象**: `src/app/`・`src/components/` の下（サブディレクトリを含む）の `.tsx` ファイル。ただし次は除く。
  - `src/components/ui/`（shadcn/ui が生成する部品）
  - `src/app/api/`（サーバー側。SSE のハートビートなどで `setInterval` を使いうるため）
  - テストファイル（`*.test.tsx`）
- **検査する内容**（ファイルの内容をテキストとして検査する。コメントの中も対象）
  - 生の色クラス（「見た目の一貫性」で定義したもの）
  - 任意値（同上）
  - `setInterval` の呼び出し（ポーリングの禁止）
- 検査はファイルの内容（文字列）を受け取って違反の一覧を返す関数にし、その関数を文字列の入力で直接テストする（検出できることを確かめる）。そのうえで、実際の走査対象のファイルに違反が0件であることを検査する。
- 違反が見つかったときは、ファイルのパスと違反した文字列（例: `src/components/foo.tsx: bg-blue-500`）をテストの失敗メッセージに出す。

### テスト

- 画面部品のテストは Vitest + Testing Library（`@testing-library/react`・`@testing-library/user-event`）+ jsdom で書き、ファイル名は `*.test.tsx` にする。
- `*.test.tsx` は jsdom の環境で、既存の `*.test.ts` はこれまでどおり Node の環境で実行する。
- ブラウザを使うE2Eテストは書かない。

## 受け入れ条件

### 土台（依存の導入と初期化）

- [ ] `npm run build` が成功する
- [ ] `tsconfig.json` の `compilerOptions.strict` が `true` である
- [ ] `src/components/ui/` に、「土台のファイル」の表の12ファイル（`button.tsx`・`input.tsx`・`textarea.tsx`・`label.tsx`・`card.tsx`・`alert-dialog.tsx`・`dropdown-menu.tsx`・`select.tsx`・`sonner.tsx`・`badge.tsx`・`skeleton.tsx`・`separator.tsx`）がすべて存在する
- [ ] `*.test.tsx` の中で `Button` を描画すると、`getByRole("button", { name: <ボタンの文言> })` で取得できる（jsdom で実行される）
- [ ] `cn("px-2", "px-4")` が `"px-4"` を返す
- [ ] `cn("a", false, undefined, "b")` が `"a b"` を返す
- [ ] `components.json` の `aliases.ui` が `@/components/ui`、`aliases.utils` が `@/lib/utils` である
- [ ] `src/app/globals.css` に `--background`・`--foreground`・`--primary`・`--muted-foreground`・`--destructive` の CSS 変数が定義されている
- [ ] `RootLayout`（`src/app/layout.tsx`）の描画結果の `html` 要素の `lang` 属性が `ja` である
- [ ] 仮の `src/app/page.tsx` を描画すると、`h1` が1つだけある
- [ ] 既存の `src/*.test.ts` が変更なしで Node の環境で通る

### 共通部品と規約テスト

- [ ] `AppHeader` を描画すると、`banner` ロールの要素の中に、名前が「type-chat」で `href` が `/` のリンクがある
- [ ] `AppHeader` を描画しても、`h1` がない
- [ ] `EmptyState` を描画すると、`title` が `h2` として、`description` が文として表示される
- [ ] `EmptyState` の `action` に渡したボタンが描画され、押すとそのボタンの `onClick` が呼ばれる
- [ ] `ConfirmDialog` を `open: true` で描画すると、`alertdialog` ロールの要素に `title` と `description` が表示される
- [ ] `ConfirmDialog` の確定ボタン（`confirmLabel` の文言）を押すと、`onConfirm` が1回呼ばれ、`onOpenChange(false)` は呼ばれない
- [ ] `ConfirmDialog` の「キャンセル」を押すと、`onOpenChange(false)` が呼ばれ、`onConfirm` は呼ばれない
- [ ] `ConfirmDialog` を `pending: true` で描画すると、確定ボタンが無効で、文言が `pendingLabel` になる
- [ ] `ConfirmDialog` を `pending: true` で描画すると、「キャンセル」が無効になる
- [ ] `ConfirmDialog` を `destructive: true` で描画すると、確定ボタンのクラスに `bg-destructive` が含まれる
- [ ] `RootLayout` の描画結果に、共通ヘッダー（名前が「type-chat」で `href` が `/` のリンク）がある
- [ ] `RootLayout` に渡した `children` が `main` 要素の中に描画され、`main` のクラスに `mx-auto`・`max-w-2xl`・`px-4` が含まれる
- [ ] `RootLayout` の描画結果に、sonner のトーストの表示領域（`Toaster`）がある
- [ ] 規約テストの検査関数が、生の色クラス（`bg-blue-500`・`text-white`・`hover:border-gray-200`）を含む内容に対して、それぞれを違反として返す
- [ ] 規約テストの検査関数が、テーマトークンのクラス（`bg-primary`・`text-muted-foreground`・`text-destructive`・`border-border`）だけの内容に対して、違反を返さない
- [ ] 規約テストの検査関数が、任意値（`p-[13px]`・`w-[320px]`・`bg-[#1e40af]`）を含む内容に対して、それぞれを違反として返す
- [ ] 規約テストの検査関数が、`setInterval(` を含む内容に対して違反を返す
- [ ] 規約テストの走査対象の一覧に、`src/components/ui/`・`src/app/api/` の下のファイルと `*.test.tsx` が含まれない
- [ ] 規約テストの走査対象の実際のファイルに、違反が0件である

## 対象外

- 各画面の文言・導線の詳細と、画面ごとのテスト（`docs/specs/web-api-foundation.md`・`docs/specs/web-groups.md`・`docs/specs/web-chat.md`・`docs/specs/group-settings.md` などで扱う）。「1画面の主操作は1つまで」「`h1` は1つ」は、各画面の仕様の受け入れ条件で確かめる
- 利用者メニュー（`src/components/user-menu.tsx`）と `/start` 画面（`docs/specs/web-api-foundation.md` で扱う）
- SSE の購読（`docs/specs/realtime-events.md` で扱う）
- ブラウザを使うE2Eテスト、見た目の回帰テスト（スクリーンショットの比較）
- ダークモードの切り替え・テーマの選択・利用者ごとの表示設定
- 規約テストで検出しない書き方（`style` 属性での色・寸法の直接指定、`setTimeout` の再帰によるポーリングなど）。規約としては使わないが、機械判定の対象にはしない
- 多言語対応（文言は日本語だけ）

## 関連

- Issue #137（この仕様書の下書き）、親Issue #133、実装タスク #147（土台）・#148（共通部品と規約テスト）
- `docs/decisions/0001-web-app-stack.md`（Next.js App Router・Tailwind CSS + shadcn/ui・SSE・ポーリングを使わない判断、層構成）
- `src/app/layout.tsx`、`src/app/globals.css`、`src/app/page.tsx`、`src/lib/utils.ts`、`components.json`
- `src/components/ui/button.tsx`、`src/components/ui/input.tsx`、`src/components/ui/textarea.tsx`、`src/components/ui/label.tsx`、`src/components/ui/card.tsx`、`src/components/ui/alert-dialog.tsx`、`src/components/ui/dropdown-menu.tsx`、`src/components/ui/select.tsx`、`src/components/ui/sonner.tsx`、`src/components/ui/badge.tsx`、`src/components/ui/skeleton.tsx`、`src/components/ui/separator.tsx`
- `src/components/app-header.tsx`、`src/components/empty-state.tsx`、`src/components/confirm-dialog.tsx`、`src/components/ui-conventions.test.ts`
- `docs/specs/web-api-foundation.md`（`/start`・利用者メニュー・APIのエラー応答の `code`）、`docs/specs/realtime-events.md`（SSE）、`docs/specs/web-groups.md`（ホーム）、`docs/specs/web-chat.md`（チャット）、`docs/specs/group-settings.md`・`docs/specs/group-members.md`・`docs/specs/message-delete.md`・`docs/specs/group-delete.md`（設定画面と確認ダイアログを使う操作）
