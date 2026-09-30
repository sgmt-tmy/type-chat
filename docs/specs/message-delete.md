---
status: implemented        # draft / approved / implemented / deprecated
updated: 2026-09-30
---

# 投稿者本人によるメッセージの削除

## 目的

投稿者本人だけが、自分が投稿したメッセージを削除できるようにする（親Issue #133）。
`Message.senderId`（`docs/specs/data-model.md`）を使って投稿者かどうかを検証し、ドメイン・ユースケース・API・チャット画面（`docs/specs/web-chat.md`）の各層で削除を扱えるようにする。変化は `message.deleted` で、削除した時点のグループのメンバーへすぐ届ける（`docs/specs/realtime-events.md`）。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行う。削除できるのが投稿者本人だけであることは、ドメイン（`src/message.ts` の `assertCanDeleteMessage`）が検証する。メンバーかどうかは `findGroupAsMember`（`docs/specs/web-groups.md`）が検証する。
- 削除の方式は**物理削除**にする。`MessageRepository.delete`（`docs/specs/persistence.md`）で行に対応する行を消す。論理削除（削除フラグ）や「削除されました」の表示は行わない（「対象外」）。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、成功の応答を名前つきのキーで包む、本文のない成功は 204）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループと、そのグループにないメッセージ（別のグループのメッセージID、存在しないメッセージID）は、同じく 404（`code: "not_found"`、`message: "メッセージが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」と同じ考え方。メッセージの存在も秘匿する）。投稿者本人でない場合は、ドメインの `DomainError`（`forbidden`）のとおり 403 にする。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、確認ダイアログは取り消せない操作だけ、フィードバックの出し方、アイコンだけのボタンの `aria-label`、ポーリングしない）は `docs/specs/ui-foundation.md` に従う。メッセージの削除は「取り消せない操作」の4つの1つなので、確認ダイアログを出す。
- イベントの種類・内容・届け先は `docs/specs/realtime-events.md` に従う。削除に成功したら、`message.deleted`（`{ groupId, messageId }`）を「削除した時点のグループのメンバー」（削除した本人を含む）に発行する。

### ドメイン（`src/message.ts`）

```ts
export function assertCanDeleteMessage(message: Message, requesterId: string): void;
```

- `requesterId` が `message.senderId` と異なれば、`DomainError`（`code: "forbidden"`、文言 `メッセージを削除できるのは投稿者のみです`）を投げる。
- `requesterId` が `message.senderId` と同じなら、何も返さず（戻り値は `undefined`）、例外も投げない。
- 純粋関数で、`Message` を変更しない（削除自体はリポジトリが行う。`docs/specs/persistence.md` の `MessageRepository.delete`）。

| 関数 | 条件 | 文言 | `code` |
| --- | --- | --- | --- |
| `assertCanDeleteMessage` | `requesterId` が `message.senderId` と異なる | `メッセージを削除できるのは投稿者のみです` | `forbidden` |

### ユースケース（`src/server/messages.ts` に追加）

```ts
export async function deleteMessageByUser(
  groups: GroupRepository,
  messages: MessageRepository,
  groupId: string,
  userId: string,
  messageId: string,
): Promise<void>;
```

次の順に行う。

1. **グループのロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（グループがない・メンバーでないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）がそのまま伝わる）。
2. **メッセージのロード**: `MessageRepository.findById(messageId)` でメッセージを取る。`null`、または見つかった `message.groupId` が `group.id` と異なる（別のグループのメッセージID）ときは、`DomainError`（`code: "not_found"`、文言 `メッセージが見つかりません`）を投げる。
3. **ドメイン**: `assertCanDeleteMessage(message, userId)`。投稿者本人でなければ `forbidden`（`メッセージを削除できるのは投稿者のみです`）。
4. **削除**: `MessageRepository.delete(messageId)` で削除する。
5. **発行**: `publish({ type: "message.deleted", data: { groupId: group.id, messageId } }, group.members)` を呼ぶ（`src/server/events.ts`）。届け先は削除した時点のメンバー全員で、削除した本人を含む。
6. 戻り値はない（`void`）。

- 1〜3のどこかで例外が投げられたら、それより後の手順を行わない（削除しない・発行しない）。
- 2の「メッセージがそのグループにない」を `not_found` にするのは、404 で「メンバーでない」場合と区別できないようにするため（存在の秘匿）。

### メッセージの削除API（`src/app/api/groups/[groupId]/messages/[messageId]/route.ts`、新規）

```ts
export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string; messageId: string }> },
): Promise<Response>;
```

現在の利用者が必要（`requireCurrentUser`。いなければ 401）。Route Handler は `createGroupRepository(getDb())`・`createMessageRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。`context.params` は Next.js（App Router）の動的なセグメントの値（`Promise`）。

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `DELETE /api/groups/[groupId]/messages/[messageId]` | なし | 204（本文なし） | 401、403（投稿者でない）、404（メンバーでない・グループが存在しない・メッセージがそのグループにない・メッセージが存在しない） |

- `deleteMessageByUser(groups, messages, groupId, <現在の利用者のid>, messageId)` を呼ぶ。
- 上の表にないメソッドは Next.js の既定の 405 に任せる（`GET`・`POST /api/groups/[groupId]/messages` は `docs/specs/web-chat.md` のまま、別のファイル）。

### チャット画面

UI の規約は `docs/specs/ui-foundation.md` に従う。メッセージの削除はこの画面で唯一「確認ダイアログを出す」操作になる。主操作（投稿フォームの「送信」）は変えない。

#### メッセージ一覧（`src/components/message-list.tsx`）

`docs/specs/web-chat.md` の `MessageList` に、次を足す。

```tsx
export type MessageListProps = {
  state: "loading" | "failed" | "loaded";
  messages: ChatMessage[];
  currentUserId: string;
  groupId: string; // 追加
  onRetry: () => void;
  onStartWriting: () => void;
  onDeleted: (messageId: string) => void; // 追加
};
```

- **操作メニュー**: 自分のメッセージ（`senderId` が `currentUserId`）の行にだけ、`DropdownMenu` のトリガーのアイコンボタン（`variant="ghost"`・`size="icon"`、横三点のアイコン、`aria-label="メッセージの操作"`）を吹き出しの近くに置く。他人のメッセージの行には、この操作メニューを描画しない。
  - メニューに項目「削除」を置く。選ぶと、確認ダイアログ（`ConfirmDialog`。`docs/specs/ui-foundation.md`）を開く。
- **確認ダイアログ**（メッセージの削除は取り消せない操作のため確認する。`docs/specs/ui-foundation.md`）:
  - `title`: `このメッセージを削除しますか？`
  - `description`: `削除すると元に戻せません。`
  - `confirmLabel`: `削除する`、`pendingLabel`: `削除中…`、`destructive`: `true`
  - 確定ボタンを押すと、`apiFetch<null>("/api/groups/<groupId>/messages/<messageId>", { method: "DELETE" })` を呼ぶ（`messageId` はメニューを開いたときの行のメッセージの `id`）。送信中は `pending` を `true` にする。
  - 成功したら、`toast.success("メッセージを削除しました")` を出し、ダイアログを閉じ（`open` を `false`）、`onDeleted(messageId)` を呼ぶ。
  - 失敗したら、`toast.error(message)` を出し、ダイアログを開いたままにする（`pending` は `false` に戻す）。
  - 「キャンセル」を押すと、APIを呼ばずにダイアログを閉じる。
- 一覧・読み込み中・空状態・失敗状態・スクロールの振る舞いは `docs/specs/web-chat.md` のまま変えない。

#### チャット画面の本体（`src/components/chat-view.tsx`）

- `MessageList` に `groupId` と `onDeleted` を渡す。`onDeleted(messageId)` は、一覧の状態から `id` が `messageId` のメッセージを取り除く（`docs/specs/web-chat.md` の「メッセージを足す規則」に対する、取り除く規則）。
- `useLiveEvents` の `handlers` に `message.deleted` を足す（`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）。
  - `data.groupId` がこの画面の `groupId` と違えば、何もしない（ストリームには、自分がメンバーのほかのグループのイベントも届く）。
  - 同じなら、一覧の状態から `id` が `data.messageId` のメッセージを取り除く。すでに（`onDeleted` で）取り除かれていれば、何もしない（`Array.prototype.filter` はそのメッセージがなくてもエラーにならない）。
- 削除に成功したメッセージが `message.deleted` として自分にも届くため、上の2つの経路（`onDeleted` と `message.deleted` のハンドラ）はどちらも同じ「一覧から取り除く」処理を呼ぶだけで、二重に問題は起きない（取り除く操作は冪等）。

### 追加・変更するファイル

| パス | 内容 |
| --- | --- |
| `src/message.ts` | `assertCanDeleteMessage` を追加 |
| `src/server/messages.ts` | `deleteMessageByUser` を追加 |
| `src/app/api/groups/[groupId]/messages/[messageId]/route.ts` | `DELETE /api/groups/[groupId]/messages/[messageId]`（新規） |
| `src/components/message-list.tsx` | 自分のメッセージの操作メニューと削除の確認ダイアログ |
| `src/components/chat-view.tsx` | `MessageList` への `groupId`・`onDeleted` の配線、`message.deleted` のハンドラ |

### テスト

- ドメインのテストは `src/message.test.ts` に書く（Node の環境）。
- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。発行のテストは、`src/server/events.ts` の `subscribe` で購読し、最後に解除関数を呼ぶ（`docs/specs/realtime-events.md` の「テスト」）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。メッセージは `postMessageToGroup` で作り `MessageRepository.insert` で保存する。ハンドラには `{ params: Promise.resolve({ groupId, messageId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`apiFetch`（または `fetch`）、sonner の `toast`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。

## 受け入れ条件

### ドメイン（`src/message.ts` の `assertCanDeleteMessage`）

- [x] 投稿者本人（`requesterId` が `message.senderId` と同じ）で `assertCanDeleteMessage` を呼んでも、例外が投げられない
- [x] 投稿者本人でない利用者で `assertCanDeleteMessage` を呼ぶと、`code` が `"forbidden"`、文言が `メッセージを削除できるのは投稿者のみです` の `DomainError` が投げられる

### ユースケース（`src/server/messages.ts` の `deleteMessageByUser`）

- [x] 投稿者本人が `deleteMessageByUser(groups, messages, groupId, <投稿者のid>, messageId)` を呼ぶと、その後の `MessageRepository.findById(messageId)` が `null` を返す
- [x] `deleteMessageByUser` で削除すると、`subscribe` した削除した時点のグループのメンバー全員（削除した本人を含む）のリスナーが、`type` が `message.deleted`、`data.groupId` がそのグループの `id`、`data.messageId` がそのメッセージの `id` のイベントで1回ずつ呼ばれる
- [x] `deleteMessageByUser` で削除しても、`subscribe` したメンバーでない利用者のリスナーは呼ばれない
- [x] 投稿者でないメンバーが `deleteMessageByUser` を呼ぶと、`code` が `"forbidden"`、文言が `メッセージを削除できるのは投稿者のみです` の `DomainError` が投げられ、メッセージが残り、イベントが発行されない
- [x] メンバーでない利用者が `deleteMessageByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ、イベントが発行されない
- [x] 存在しないメッセージIDで `deleteMessageByUser` を呼ぶと、`code` が `"not_found"`、文言が `メッセージが見つかりません` の `DomainError` が投げられる
- [x] 別のグループのメッセージIDで `deleteMessageByUser` を呼ぶと、`code` が `"not_found"`、文言が `メッセージが見つかりません` の `DomainError` が投げられ、そのメッセージが残る

### `DELETE /api/groups/[groupId]/messages/[messageId]`

- [x] 投稿者本人で `DELETE /api/groups/[groupId]/messages/[messageId]` を呼ぶと、204 と空の本文が返り、その後の同じグループの `GET /api/groups/[groupId]/messages` にそのメッセージが含まれない
- [x] `DELETE` に成功すると、`subscribe` したグループの別のメンバーのリスナーが、`data.groupId` がそのグループの `id`、`data.messageId` がそのメッセージの `id` の `message.deleted` のイベントで呼ばれる
- [x] 投稿者でないメンバーで `DELETE` を呼ぶと、403（`code: "forbidden"`、`message: "メッセージを削除できるのは投稿者のみです"`）が返り、メッセージが残る
- [x] メンバーでない利用者で `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "メッセージが見つかりません"`）が返る
- [x] 存在しないメッセージID（UUID の形）で `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "メッセージが見つかりません"`）が返る
- [x] 別のグループのメッセージIDで、そのグループのメンバーが `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "メッセージが見つかりません"`）が返り、そのメッセージが残る
- [x] 存在しないグループID（UUID の形）で `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "メッセージが見つかりません"`）が返る
- [x] Cookie のない `Request` で `DELETE` を呼ぶと、401（`code: "unauthenticated"`）が返る

### メッセージ一覧（`src/components/message-list.tsx`）

- [x] 自分のメッセージの行に、`aria-label` が `メッセージの操作` のボタンがある
- [x] 他人のメッセージの行に、`aria-label` が `メッセージの操作` のボタンがない
- [x] 自分のメッセージの操作メニューを開くと、「削除」の項目がある
- [x] 「削除」を選ぶと、`alertdialog` に `このメッセージを削除しますか？` と `削除すると元に戻せません。` が出る
- [x] 確認ダイアログの「削除する」ボタンのクラスに `bg-destructive` が含まれる
- [x] 確認ダイアログの「キャンセル」を押すと、`DELETE` が呼ばれずにダイアログが閉じる
- [x] 確認ダイアログの「削除する」を押すと、`DELETE /api/groups/<groupId>/messages/<messageId>` が呼ばれる
- [x] 送信中は、確認ダイアログの確定ボタンが無効で、文言が「削除中…」になる
- [x] 削除に成功すると、`toast.success("メッセージを削除しました")` が呼ばれ、`onDeleted` がそのメッセージの `id` で1回呼ばれる
- [x] 削除が失敗すると、`toast.error` がその `message` で呼ばれ、ダイアログが開いたままで、`onDeleted` が呼ばれない
- [x] `src/components/message-list.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

### チャット画面の本体（`src/components/chat-view.tsx`）

- [x] `ChatView` で自分のメッセージの削除に成功すると、`onDeleted` が呼ばれ、そのメッセージが一覧から消える
- [x] `ChatView` で、この画面の `groupId` の `message.deleted` のハンドラを、一覧にあるメッセージの `id` で呼ぶと、そのメッセージが一覧から消える
- [x] `ChatView` で、別の `groupId` の `message.deleted` のハンドラを呼んでも、一覧が変わらない
- [x] `ChatView` で、一覧にない `id` の `message.deleted` のハンドラを呼んでも、例外にならず一覧が変わらない
- [x] `ChatView` で自分の削除の成功（`onDeleted`）の後に、同じ `id` の `message.deleted` のハンドラを呼んでも、例外にならない

## 対象外

- 論理削除（削除フラグを立てて残すこと）と、「削除されました」の表示（削除した行を一覧から取り除くだけで、跡を残さない）
- オーナーによる他人のメッセージの削除（削除できるのは投稿者本人だけ）
- メッセージの編集
- 削除の取り消し（元に戻す操作）、削除したメッセージの復元
- 複数件をまとめて削除すること
- 削除の通知（ブラウザの通知・チャットへのシステムメッセージなど）と、削除の履歴の記録・表示
- 切断中に削除されたメッセージの `onReconnect` での扱い（取り直し（`GET`）が削除後の一覧を返すので、そのまま反映される。特別な扱いはしない）
- グループの削除に伴うメッセージの削除（`docs/specs/persistence.md` の `messages` の ON DELETE CASCADE に任せる。`group.deleted` の受信は別の仕様で扱う）
- ブラウザを使うE2Eテスト

## 関連

- Issue #144（この仕様書の下書き）、親Issue #133、前提の仕様書 #137（`ui-foundation.md`）・#138（`web-api-foundation.md`）・#139（`realtime-events.md`）
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/data-model.md`（`Message`・`Message.senderId`・`DomainError` の `code`）
- `docs/specs/persistence.md`（`MessageRepository.findById`・`delete`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`、存在の秘匿、`apiFetch`（204 は `data: null`）、Route Handler のテストの方法）
- `docs/specs/ui-foundation.md`（確認ダイアログはメッセージの削除を含む4つだけ、`ConfirmDialog`、アイコンだけのボタンの `aria-label`、フィードバック、画面のテスト）
- `docs/specs/realtime-events.md`（`message.deleted` の内容と届け先、`publish`・`subscribe`、`useLiveEvents`、1タブ1接続）
- `docs/specs/web-groups.md`（`findGroupAsMember`）
- `docs/specs/web-chat.md`（`ChatView`・`MessageList`、メッセージを足す規則、`message.created` の受信。この仕様では「対象外」としていたメッセージの削除を扱う）
- `src/message.ts`、`src/server/messages.ts`、`src/app/api/groups/[groupId]/messages/[messageId]/route.ts`、`src/components/message-list.tsx`、`src/components/chat-view.tsx`
