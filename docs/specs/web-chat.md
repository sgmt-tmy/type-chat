---
status: implemented
updated: 2026-09-30
---

# メッセージの一覧・投稿とチャット画面

## 目的

既存のドメイン機能「グループへのメッセージ投稿」（`docs/specs/group-message.md`、`postMessageToGroup`）を、APIとチャット画面（`/groups/[groupId]`）から使えるようにする（親Issue #133）。
グループのメンバーが、メッセージの一覧を読み、投稿し、ほかのメンバーの新着を SSE（`message.created`）ですぐに受け取れるようにする。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行い、本文の規則（トリム・空・1000文字）はドメイン（`src/message.ts` の `createMessage`）が、メンバーかどうかは `findGroupAsMember`（`docs/specs/web-groups.md`）が検証する。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、成功の応答を名前つきのキーで包む、日時は ISO 8601 の文字列）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループは、存在しないグループと同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」）。メンバーでない利用者の投稿も、`postMessageToGroup` の `forbidden`（403）ではなく 404 にする。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、フィードバックの出し方、読み込み中は Skeleton、空状態は `EmptyState`、ポーリングしない）は `docs/specs/ui-foundation.md` に従う。
- イベントの種類・内容・届け先は `docs/specs/realtime-events.md` に従う。投稿に成功したら、`message.created` を「投稿した時点のグループのメンバー」（投稿者を含む）に発行する。

### ユースケース（`src/server/messages.ts`）

```ts
import type { Message } from "../message";
import type { GroupRepository } from "../db/group-repository";
import type { MessageRepository } from "../db/message-repository";
import type { UserRepository } from "../db/user-repository";

/** 投稿者の名前を含むメッセージ */
export type MessageWithSender = Message & { senderName: string };

export async function listMessagesOfGroup(
  groups: GroupRepository,
  messages: MessageRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
): Promise<MessageWithSender[]>;

export async function postMessageByUser(
  groups: GroupRepository,
  messages: MessageRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  text: string,
): Promise<MessageWithSender>;
```

- `listMessagesOfGroup(groups, messages, users, groupId, userId)`:
  - `findGroupAsMember(groups, groupId, userId)` でグループを取る（グループがない・メンバーでないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）がそのまま伝わる）。
  - `MessageRepository.listByGroup(groupId)` のメッセージを、その順（`sentAt` の昇順）のまま全件返す。1件もなければ空配列。
  - 各メッセージの `senderName` は、`senderId` の利用者を `UserRepository.findById` で探した `name`。脱退した・外されたメンバーの過去のメッセージも、利用者が残っているので名前が出る。利用者が見つからない（通常は起きない）ときは `UNKNOWN_MEMBER_NAME`（`不明な利用者`。`src/server/groups.ts`）にする。
  - 同じ投稿者の利用者は1回だけ探す（メッセージごとに探さない）。
- `postMessageByUser(groups, messages, users, groupId, userId, text)`: 次の順に行う。
  1. **ロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（メンバーでなければ `not_found`）。
  2. **ドメイン**: `postMessageToGroup(group, userId, text)` でメッセージを作る（`sentAt` は現在時刻、本文はトリム後。空・1000文字超は `createMessage` の `DomainError`（`validation`））。
  3. **保存**: `MessageRepository.insert(message)` で保存する。
  4. **発行**: `publish({ type: "message.created", data: { groupId: group.id, message } }, group.members)` を呼ぶ（`src/server/events.ts`）。届け先は投稿した時点のメンバー全員で、投稿者本人を含む。
  5. 投稿者の名前（`UserRepository.findById(userId)` の `name`。見つからなければ `不明な利用者`）を `senderName` に足して返す。
  - 1〜3のどこかで例外が投げられたら、それより後の手順を行わない（保存しない・発行しない）。
  - イベントの `data.message` は `Message`（`senderName` を含まない）。`senderName` はAPIの応答にだけ含める（`docs/specs/realtime-events.md` のイベントの形を変えない）。

### メッセージのAPI（`src/app/api/groups/[groupId]/messages/route.ts`）

```ts
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

いずれも現在の利用者が必要（`requireCurrentUser`。いなければ 401）。`createGroupRepository(getDb())`・`createMessageRepository(getDb())`・`createUserRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `GET /api/groups/[groupId]/messages` | なし | 200 `{ "messages": [{ "id": string, "groupId": string, "senderId": string, "senderName": string, "text": string, "sentAt": string }] }`（`sentAt` の昇順の全件） | 401、404 |
| `POST /api/groups/[groupId]/messages` | `{ "text": string }` | 201 `{ "message": { "id": string, "groupId": string, "senderId": string, "senderName": string, "text": string, "sentAt": string } }` | 400（空・1000文字超・本文の形式）、401、404 |

- `GET` は `listMessagesOfGroup`、`POST` は `postMessageByUser(…, groupId, <現在の利用者のid>, text)` を呼ぶ。
- `sentAt` は ISO 8601 の文字列（`jsonResponse` が `Date` を変換する）。
- `POST` の `text` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）にし、保存も発行もしない。
- 自分がメンバーでないグループと、存在しないID（UUID の形でない値を含む）は、`GET`・`POST` とも同じ 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする。
- 上の表にないメソッドは Next.js の既定の 405 に任せる（メッセージの削除は `docs/specs/message-delete.md` で扱う）。

### 画面

UI の規約は `docs/specs/ui-foundation.md` に従う。チャット画面の主操作は投稿フォームの「送信」ボタンだけにする。メッセージの投稿は成功のトーストを出さない（一覧に表示されることを成功のフィードバックとする。`docs/specs/ui-foundation.md` の「フィードバック」）。

#### チャット画面（`/groups/[groupId]`、`src/app/groups/[groupId]/page.tsx`）

```tsx
export default async function ChatPage(props: {
  params: Promise<{ groupId: string }>;
}): Promise<React.JSX.Element>;
```

- Server Component。`requireCurrentUserInPage()` で現在の利用者を読む（いなければ `/start` へリダイレクトする。`docs/specs/web-api-foundation.md`）。
- `getGroupDetail(createGroupRepository(getDb()), createUserRepository(getDb()), groupId, <現在の利用者のid>)` でグループを取る（`docs/specs/web-groups.md`）。`DomainError`（`not_found`）が投げられたら（自分がメンバーでない・存在しない）、`next/navigation` の `notFound()` を呼ぶ（Next.js の 404 の画面を出す）。
- `ChatView` に、`groupId`・`groupName`（グループ名）・`currentUserId`（現在の利用者の `id`）・`members`（`GroupDetail` の `members`）を渡して描画する。

#### チャット画面の本体（`src/components/chat-view.tsx`）

```tsx
import type { GroupMemberDetail } from "../server/groups";

export type ChatViewProps = {
  groupId: string;
  groupName: string;
  currentUserId: string;
  members: GroupMemberDetail[];
};

export function ChatView(props: ChatViewProps): React.JSX.Element;
```

Client Component。上から順に `ChatHeader`・`MessageList`・`MessageComposer` を描画し、メッセージの一覧の状態を持つ。

- **取得**: マウントしたときに `apiFetch<{ messages: ChatMessage[] }>("/api/groups/<groupId>/messages")` で一覧を取得する。
- **一覧の状態**: `MessageList` に渡す `state` は、最初の取得が終わるまで `"loading"`、最初の取得が失敗したら `"failed"`、成功したら `"loaded"`。
- **最初の取得の失敗**: `toast.error(message)` を出し、`MessageList` の「再読み込み」で取り直す（`onRetry`）。
- **メッセージを足す規則**（リアルタイムの受信と、自分の送信の成功で共通）:
  - 同じ `id` のメッセージがすでに一覧にあれば、何もしない（自分の投稿は、APIの応答と `message.created` の両方で届くため。二重に表示しない）。
  - なければ一覧に足し、一覧を `sentAt` の昇順に並べる。
- **リアルタイム**: `useLiveEvents`（`docs/specs/realtime-events.md`）を、チャット画面の中でこの部品だけが呼ぶ（1タブ1接続）。
  - `message.created` を受け取ったら:
    - `data.groupId` がこの画面の `groupId` と違えば、何もしない（ストリームには、自分がメンバーのほかのグループのイベントも届く）。
    - 一覧の状態が `"loaded"` でなければ、何もしない（取得の結果に任せる）。
    - 投稿者の名前を、`members` と一覧のメッセージの `senderName` から `senderId` で探す。見つかれば、`senderName` を足したメッセージを上の規則で足す。見つからなければ（画面を開いた後に加わったメンバーなど）、足さずに一覧を取り直す（`GET`。応答に名前が含まれる）。
  - `onReconnect` で一覧を取り直す（切断中の取りこぼしを埋める）。
  - 取り直しの間は `Skeleton` に戻さず、表示中の一覧を残す。取り直しが成功したら、その応答で一覧を置き換える。取り直しが重なったときは、最後に始めた取得の結果だけを反映する（古い応答で新しい一覧を上書きしない）。取り直しが失敗したら、`toast.error(message)` を出し、表示中の一覧を残す。
  - 一定間隔での取り直し（`setInterval`・`setTimeout` の繰り返し）はしない。
- **投稿フォームとのつなぎ**:
  - `MessageComposer` の `onSent` で受け取ったメッセージを、上の規則で一覧に足す。
  - `MessageList` の `onStartWriting` で、`document.getElementById(MESSAGE_INPUT_ID)` の入力欄にフォーカスを移す。
- `message.deleted`・`group.updated`・`group.deleted` のハンドラは、この仕様では持たない（`docs/specs/message-delete.md`・`docs/specs/group-settings.md`・`docs/specs/group-delete.md` で、この部品の `useLiveEvents` に足す）。

#### ヘッダー（`src/components/chat-header.tsx`）

```tsx
export type ChatHeaderProps = { groupId: string; groupName: string };

export function ChatHeader(props: ChatHeaderProps): React.JSX.Element;
```

- 左から順に、「戻る」（`/` へのリンク。Next.js の `Link`。左向きの矢印のアイコンと文言「戻る」）、グループ名（この画面のただ1つの `h1`。長い名前は1行で省略表示する（`truncate`））、設定（`/groups/<groupId>/settings` へのリンク。歯車のアイコンだけのボタンで、`aria-label="グループ設定"`。`docs/specs/group-settings.md`）を並べる。
- 設定へのリンクは `docs/specs/ui-foundation.md` の「画面一覧と導線」に従って置く（設定画面は `docs/specs/group-settings.md` で作る）。
- どちらのリンクも主操作の見た目（`bg-primary`）にしない。

#### メッセージ一覧（`src/components/message-list.tsx`）

```tsx
import type { MessageJson } from "./use-live-events";

/** 画面で扱うメッセージ（sentAt は ISO 8601 の文字列） */
export type ChatMessage = MessageJson & { senderName: string };

export type MessageListProps = {
  state: "loading" | "failed" | "loaded";
  messages: ChatMessage[];
  currentUserId: string;
  onRetry: () => void;
  onStartWriting: () => void;
};

/** 最下部から何px以内なら「最下部にいる」とみなすか */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** ISO 8601 の文字列を、ブラウザの地域の時刻で HH:mm にする */
export function formatMessageTime(sentAt: string): string;

export function MessageList(props: MessageListProps): React.JSX.Element;
```

Client Component。

- **読み込み中**（`state: "loading"`）: メッセージの形に合わせた `Skeleton` を3件分描画し、一覧の領域に `aria-busy="true"` を付ける。一覧・空状態は描画しない。
- **最初の取得の失敗**（`state: "failed"`）: `EmptyState`（`title`: `メッセージを読み込めませんでした`、`description`: `接続を確認して、もう一度お試しください`、`action`: 「再読み込み」ボタン（`variant="outline"`。押すと `onRetry`））を描画する。
- **空状態**（`state: "loaded"` で0件）: `EmptyState` を描画する。
  - `title`: `まだメッセージはありません`
  - `description`: `最初のメッセージを送ってみましょう`
  - `action`: 「メッセージを入力する」ボタン（`variant="outline"`。主操作ではない）。押すと `onStartWriting` を呼ぶ。
- **一覧**（`state: "loaded"` で1件以上）: `ol` 要素に、メッセージごとに1つの `li` を `messages` の順（`sentAt` の昇順）で並べる。
  - 自分のメッセージ（`senderId` が `currentUserId`）: 行を右寄せ（`justify-end`）にし、吹き出しを `bg-primary text-primary-foreground` にする。投稿者名は出さない。
  - 他人のメッセージ: 行を左寄せ（`justify-start`）にし、吹き出しの上に投稿者名（`senderName`、`text-muted-foreground`）を出す。吹き出しは `bg-muted`。
  - 各メッセージに、時刻を `time` 要素（`dateTime` 属性に `sentAt`、文言は `formatMessageTime(sentAt)`、`text-muted-foreground`）で出す。
  - 本文は改行をそのまま表示し、長い語は折り返す（`whitespace-pre-wrap break-words`）。
- `formatMessageTime(sentAt)`: `new Date(sentAt)` のブラウザの地域の時・分を、それぞれ2桁（0埋め）にして `HH:mm` で返す（例: `09:05`）。日付は出さない。
- **スクロール**: 画面（`window`）のスクロールで一覧を読む。投稿フォームは画面下部に固定する（`MessageComposer`）。
  - 「最下部にいる」とは、`window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_BOTTOM_THRESHOLD_PX` のこと。
  - `window` の `scroll` イベントのたびに、最下部にいるかどうかを記録する（記録の初期値は「いる」）。
  - 最下部へのスクロールは `window.scrollTo({ top: document.documentElement.scrollHeight })` で行う。
  - 画面を開いたとき: `state` が `"loaded"` になって一覧を最初に描画した直後に、最下部へスクロールする。
  - 新着（`messages` の末尾に、前の描画になかった `id` のメッセージが増えた）を描画した直後:
    - 末尾のメッセージが自分のものなら、位置によらず最下部へスクロールする（自分が送った直後）。
    - 他人のものなら、直前の記録が「最下部にいる」ときだけ最下部へスクロールする。上へスクロールして読んでいる間（記録が「いない」）は、スクロールしない。
  - 取り直しで一覧を置き換えたときも、同じ規則（末尾に新しい `id` が増えたときだけ）で扱う。

#### 投稿フォーム（`src/components/message-composer.tsx`）

```tsx
import type { ChatMessage } from "./message-list";

export const MESSAGE_INPUT_ID = "message-input";

/** 残り文字数を出し始める文字数 */
export const MESSAGE_COUNTER_THRESHOLD = 900;

export type MessageComposerProps = {
  groupId: string;
  onSent: (message: ChatMessage) => void;
};

export function MessageComposer(props: MessageComposerProps): React.JSX.Element;
```

Client Component。

- **配置**: 画面の下部に固定する（`sticky bottom-0`、背景は `bg-background`）。
- `form` 要素に、見えないラベル（`sr-only`）「メッセージ」の `Textarea`（`id` は `MESSAGE_INPUT_ID`、`placeholder` は `メッセージを入力`）と、「送信」ボタン（`variant="default"`。チャット画面の主操作。`type="submit"`）を置く。
- **文字数**: 文字数は、入力欄の値をトリムした後の長さ（`String.prototype.length`。`createMessage` と同じ数え方）で数える。上限は `MESSAGE_MAX_LENGTH`（1000文字。`src/message.ts`）。
- **送信できない状態**: 次の間は「送信」を `disabled` にする。
  - 入力欄がトリム後に空
  - 文字数が `MESSAGE_MAX_LENGTH` を超えている
  - 送信中
- **残り文字数**: 文字数が `MESSAGE_COUNTER_THRESHOLD`（900）を超えたら、入力欄の直下に残り文字数を出す。
  - 1000文字以下: `残り <1000 - 文字数>文字`（`text-muted-foreground`）
  - 1000文字超: `<文字数 - 1000>文字オーバーしています`（`text-destructive`）。入力欄に `aria-invalid="true"` を付け、`aria-describedby` でこの文言の要素を指す。
  - 900文字以下では出さない。
- **キー操作**: 入力欄で
  - Enter（修飾キーなし）を押すと、送信する（改行は入らない）。送信できない状態のときは、送信せず、改行も入れない。
  - Shift+Enter を押すと、改行を入れる（送信しない）。
  - IME の変換中（`KeyboardEvent.isComposing` が `true`）の Enter は、変換の確定に使い、送信しない。
- **送信**: `apiFetch<{ message: ChatMessage }>("/api/groups/<groupId>/messages", { method: "POST", body: { text } })` を呼ぶ（`text` は入力欄の値のまま。トリムはサーバーが行う）。
  - 送信中は「送信」を `disabled` にし、文言を「送信中…」にする。入力欄は無効にしない（フォーカスを保つため）。送信中の Enter では送信しない（二重送信の防止）。
  - 成功したら、`onSent(<応答の message>)` を呼び、入力欄を空にし、フォーカスを入力欄に置いたままにする。成功のトーストは出さない。
  - 失敗が `validation` のときは、APIの `message` を入力欄の直下に出す（`aria-invalid="true"`・`aria-describedby`。`docs/specs/ui-foundation.md` の「フィードバック」）。それ以外の失敗（`not_found`・`unauthenticated`・`network`・`internal` など）は `toast.error(message)` で出す。
  - 失敗したら、入力欄の値を残し、「送信」の文言を戻す。
  - APIが返した入力エラーは、入力欄の値を変えたら消す。

### 追加・変更するファイル

| パス | 内容 | 実装の区分 |
| --- | --- | --- |
| `src/server/messages.ts` | メッセージの一覧・投稿のユースケース（投稿はロード→`postMessageToGroup`→保存→発行） | API |
| `src/app/api/groups/[groupId]/messages/route.ts` | `GET`・`POST /api/groups/[groupId]/messages` | API |
| `src/app/groups/[groupId]/page.tsx` | チャット画面 | チャット画面の表示とリアルタイム受信 |
| `src/components/chat-view.tsx` | チャット画面の本体（一覧の取得・リアルタイムの受信）。投稿フォームとのつなぎ（`onSent`・`onStartWriting`）は「投稿フォーム」で足す | チャット画面の表示とリアルタイム受信、投稿フォーム |
| `src/components/chat-header.tsx` | ヘッダー（戻る・グループ名・設定） | チャット画面の表示とリアルタイム受信 |
| `src/components/message-list.tsx` | メッセージ一覧（読み込み中・空状態・左右の寄せ・時刻・スクロール） | チャット画面の表示とリアルタイム受信 |
| `src/components/message-composer.tsx` | 投稿フォーム | 投稿フォーム |

### テスト

- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。発行のテストは、`src/server/events.ts` の `subscribe` で購読し、最後に解除関数を呼ぶ（`docs/specs/realtime-events.md` の「テスト」）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。ハンドラには `{ params: Promise.resolve({ groupId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`apiFetch`（または `fetch`）、sonner の `toast`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。
- スクロールのテストは、`window.scrollTo` を `vi.spyOn`（または `vi.fn` の代入）で差し替え、`window.innerHeight`・`window.scrollY`・`document.documentElement.scrollHeight` を `Object.defineProperty` で決めてから `scroll` イベントを発火する（jsdom はレイアウトを計算しないため）。
- `src/app/groups/[groupId]/page.tsx` のテストは、`requireCurrentUserInPage`・`getDb`（`createDb(":memory:")` のDB）・`next/navigation` の `notFound` を `vi.mock` で差し替え、`await ChatPage({ params: Promise.resolve({ groupId }) })` の結果を描画する。
- 時刻の表示のテストは、ブラウザの地域の時刻で作った日時（例: `new Date(2026, 8, 28, 9, 5).toISOString()`）を使う（テストを実行する環境のタイムゾーンによらず通るようにするため）。

## 受け入れ条件

### API

ユースケース（`src/server/messages.ts`）

- [x] `listMessagesOfGroup` が、そのグループのメッセージを `sentAt` の昇順で全件返す
- [x] `listMessagesOfGroup` の各要素の `senderName` が、`senderId` の利用者の名前である
- [x] メンバーから外された利用者の過去のメッセージも、`listMessagesOfGroup` の `senderName` がその利用者の名前になる
- [x] 利用者が存在しない `senderId` のメッセージは、`listMessagesOfGroup` の `senderName` が `不明な利用者` になる
- [x] メッセージのないグループで `listMessagesOfGroup` を呼ぶと、空配列が返る
- [x] `listMessagesOfGroup` にメンバーでない利用者IDを渡すと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられる
- [x] `listMessagesOfGroup` に存在しないグループIDを渡すと、`code` が `"not_found"` の `DomainError` が投げられる
- [x] `postMessageByUser(…, groupId, "u1", "  こんにちは  ")` が、`text` が `こんにちは`、`groupId` がそのグループの `id`、`senderId` が `u1`、`senderName` が `u1` の利用者の名前のメッセージを返す
- [x] `postMessageByUser` で投稿したメッセージが、`listByGroup` で取り出せる
- [x] `postMessageByUser` で投稿すると、`subscribe` したメンバー全員（投稿者を含む）のリスナーが、`type` が `message.created`、`data.groupId` がそのグループの `id`、`data.message.id` が返したメッセージの `id` のイベントで1回ずつ呼ばれる
- [x] `postMessageByUser` で投稿しても、`subscribe` したメンバーでない利用者のリスナーは呼ばれない
- [x] `postMessageByUser` に空白だけの本文を渡すと、`code` が `"validation"`、文言が `メッセージは空にできません` の `DomainError` が投げられ、保存されず、イベントが発行されない
- [x] `postMessageByUser` に1001文字の本文を渡すと、`code` が `"validation"`、文言が `メッセージは1000文字以内にしてください` の `DomainError` が投げられ、保存されず、イベントが発行されない
- [x] `postMessageByUser` にメンバーでない利用者IDを渡すと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ（`forbidden` ではない）、保存されず、イベントが発行されない

`GET`・`POST /api/groups/[groupId]/messages`

- [x] メンバーの利用者で `GET /api/groups/[groupId]/messages` を呼ぶと、200 と `{ messages: [...] }` が返り、`sentAt` の昇順に並ぶ
- [x] `GET /api/groups/[groupId]/messages` の各要素が `id`・`groupId`・`senderId`・`senderName`・`text`・`sentAt` を持ち、`sentAt` が ISO 8601 の文字列である
- [x] メッセージのないグループで `GET /api/groups/[groupId]/messages` を呼ぶと、200 と `{ messages: [] }` が返る
- [x] メンバーでない利用者で `GET /api/groups/[groupId]/messages` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [x] 存在しないID（UUID の形）で `GET /api/groups/[groupId]/messages` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [x] Cookie のない `Request` で `GET /api/groups/[groupId]/messages` を呼ぶと、401（`code: "unauthenticated"`）が返る
- [x] `POST /api/groups/[groupId]/messages` に `{ text: "  こんにちは  " }` を送ると、201 と `{ message: { id, groupId, senderId: <現在の利用者のid>, senderName: <現在の利用者の名前>, text: "こんにちは", sentAt } }` が返る
- [x] `POST` で投稿したメッセージが、同じグループの `GET /api/groups/[groupId]/messages` の末尾に含まれる
- [x] `POST` に成功すると、`subscribe` したメンバーのリスナーが、応答の `message.id` と同じ `id` の `message.created` のイベントで呼ばれる
- [x] `POST` に空白だけの本文を送ると、400（`code: "validation"`、`message: "メッセージは空にできません"`）が返り、メッセージが増えない
- [x] `POST` に1001文字の本文を送ると、400（`code: "validation"`、`message: "メッセージは1000文字以内にしてください"`）が返り、メッセージが増えない
- [x] `POST` に `text` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返る
- [x] メンバーでない利用者で `POST` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返り、メッセージが増えず、イベントが発行されない
- [x] 存在しないID（UUID の形）で `POST` を呼ぶと、404（`code: "not_found"`）が返る
- [x] Cookie のない `Request` で `POST` を呼ぶと、401（`code: "unauthenticated"`）が返り、メッセージが増えない

### チャット画面の表示とリアルタイム受信

チャット画面（`src/app/groups/[groupId]/page.tsx`）

- [x] 利用者の Cookie がない状態でチャット画面を描画すると、`redirect("/start")` が呼ばれる
- [x] メンバーの利用者でチャット画面を描画すると、`h1` が1つだけあり、その文言がグループ名である
- [x] メンバーでない利用者でチャット画面を描画すると、`notFound()` が呼ばれる
- [x] 存在しないグループIDでチャット画面を描画すると、`notFound()` が呼ばれる

ヘッダー（`src/components/chat-header.tsx`）

- [x] `ChatHeader` に、名前が「戻る」で `href` が `/` のリンクがある
- [x] `ChatHeader` に、名前が「グループ設定」（`aria-label`）で `href` が `/groups/<groupId>/settings` のリンクがある
- [x] `ChatHeader` の `h1` の文言が `groupName` である
- [x] `ChatHeader` のリンクのクラスに `bg-primary` が含まれない

メッセージ一覧（`src/components/message-list.tsx`）

- [x] `state: "loading"` の `MessageList` は、`Skeleton` を描画し、一覧の領域が `aria-busy="true"` で、「まだメッセージはありません」を描画しない
- [x] `state: "loaded"` で0件の `MessageList` は、`h2`「まだメッセージはありません」と `最初のメッセージを送ってみましょう` を描画する
- [x] 空状態の「メッセージを入力する」ボタンを押すと、`onStartWriting` が1回呼ばれる
- [x] 空状態の「メッセージを入力する」ボタンのクラスに `bg-primary` が含まれない
- [x] `state: "failed"` の `MessageList` は、`メッセージを読み込めませんでした` と「再読み込み」ボタンを描画し、ボタンを押すと `onRetry` が1回呼ばれる
- [x] `MessageList` にメッセージを3件渡すと、渡した順に3つの `li` が描画され、各行に本文が出る
- [x] 自分のメッセージの行のクラスに `justify-end` が含まれ、投稿者名が出ない
- [x] 他人のメッセージの行のクラスに `justify-start` が含まれ、その投稿者の `senderName` が出る
- [x] 各メッセージに、`dateTime` 属性が `sentAt` の `time` 要素があり、文言が `HH:mm` である
- [x] `formatMessageTime(new Date(2026, 8, 28, 9, 5).toISOString())` が `09:05` を返す
- [x] `formatMessageTime(new Date(2026, 8, 28, 23, 59).toISOString())` が `23:59` を返す
- [x] 本文の要素のクラスに `whitespace-pre-wrap` が含まれ、改行を含む本文が改行を保って（`textContent` に `\n` を含んで）描画される
- [x] `state` が `"loading"` から `"loaded"` に変わって一覧を描画すると、`window.scrollTo` が `{ top: document.documentElement.scrollHeight }` で呼ばれる
- [x] 最下部にいる状態（`innerHeight + scrollY >= scrollHeight - 80`）で `scroll` イベントの後に、他人の新着を末尾に足して再描画すると、`window.scrollTo` が呼ばれる
- [x] 最下部から離れた状態（`innerHeight + scrollY < scrollHeight - 80`）で `scroll` イベントの後に、他人の新着を末尾に足して再描画すると、`window.scrollTo` が呼ばれない
- [x] 最下部から離れた状態で、自分の新着を末尾に足して再描画すると、`window.scrollTo` が呼ばれる
- [x] 同じ `messages` のまま再描画しても、`window.scrollTo` が呼ばれない

チャット画面の本体（`src/components/chat-view.tsx`）

- [x] `ChatView` をマウントすると、`GET /api/groups/<groupId>/messages` が1回呼ばれ、`useLiveEvents` が1回だけ使われる
- [x] 最初の取得が終わるまで、`Skeleton` が描画される
- [x] 最初の取得に成功すると、応答のメッセージが描画される
- [x] 最初の取得が失敗すると、`toast.error` がその `message` で呼ばれ、`メッセージを読み込めませんでした` が描画される
- [x] 最初の取得の失敗の後に「再読み込み」を押すと、`GET` がもう1回呼ばれ、成功すれば一覧が描画される
- [x] この画面の `groupId` の `message.created` のハンドラを、`members` に含まれる投稿者のメッセージで呼ぶと、そのメッセージが一覧の末尾に投稿者の名前つきで描画される
- [x] 別の `groupId` の `message.created` のハンドラを呼んでも、一覧が変わらない
- [x] すでに一覧にある `id` の `message.created` のハンドラを呼んでも、そのメッセージが二重に描画されない
- [x] `sentAt` が一覧の末尾より前のメッセージの `message.created` を受け取ると、`sentAt` の昇順の位置に描画される
- [x] `members` にも一覧にもない投稿者の `message.created` を受け取ると、`GET` がもう1回呼ばれ、その応答の一覧（投稿者の名前つき）が描画される
- [x] 最初の取得が終わる前に `message.created` のハンドラを呼んでも、取得の後の一覧は応答の内容だけである
- [x] `onReconnect` を呼ぶと、`GET` がもう1回呼ばれ、新しい応答の一覧が描画される
- [x] 取り直しの応答を待っている間、表示中の一覧が残り、`Skeleton` に戻らない
- [x] 取り直しを2回続けて始め、2回目の応答が先に届いた後に1回目の応答が届いても、一覧が2回目の応答の内容のままである
- [x] 取り直しが失敗すると、`toast.error` がその `message` で呼ばれ、表示中の一覧が残る
- [x] `src/components/chat-view.tsx`・`src/components/message-list.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

### 投稿フォーム

投稿フォーム（`src/components/message-composer.tsx`）

- [x] `MessageComposer` の入力欄が、ラベル「メッセージ」で取得でき、`id` が `MESSAGE_INPUT_ID` の `textarea` である
- [x] 入力欄が空（空白だけを含む）の間、「送信」ボタンが無効である
- [x] 本文を入れて「送信」を押すと、`POST /api/groups/<groupId>/messages` に `{ text }` が送られる
- [x] 入力欄で Enter を押すと、`POST` が送られ、入力欄に改行が入らない
- [x] 入力欄で Shift+Enter を押すと、`POST` が送られず、入力欄に改行が入る
- [x] IME の変換中（`isComposing: true`）に Enter を押しても、`POST` が送られない
- [x] 入力欄が空（空白だけを含む）のときに Enter を押しても、`POST` が送られない
- [x] 送信中は「送信」ボタンが無効で、文言が「送信中…」になり、入力欄は無効にならない
- [x] 送信中に Enter を押しても、`POST` が2回目に送られない
- [x] 送信に成功すると、`onSent` が応答の `message` で1回呼ばれ、入力欄が空になり、入力欄にフォーカスがある
- [x] 送信に成功しても、`toast.success` が呼ばれない
- [x] 900文字の本文では、残り文字数が出ない
- [x] 901文字の本文では、入力欄の直下に `残り 99文字` が出る
- [x] 1000文字の本文では、`残り 0文字` が出て、「送信」ボタンが有効である
- [x] 1001文字の本文では、`1文字オーバーしています` が出て、「送信」ボタンが無効になり、入力欄が `aria-invalid="true"` で、`aria-describedby` がその文言の要素を指す
- [x] 1001文字の本文で Enter を押しても、`POST` が送られない
- [x] 前後の空白を除いて1000文字の本文（前後に空白を足して1000文字を超える）では、「送信」ボタンが有効である
- [x] 送信が通信エラーで失敗すると、`toast.error` がその `message` で呼ばれ、入力欄の値が残り、「送信」の文言が戻り、`onSent` が呼ばれない
- [x] 送信が 404（`not_found`）で失敗すると、`toast.error("グループが見つかりません")` が呼ばれる
- [x] 送信が 400（`validation`）で失敗すると、APIの `message` が入力欄の直下に出て、入力欄が `aria-invalid="true"` になり、`toast.error` が呼ばれない
- [x] APIの入力エラーを出した後に入力欄の値を変えると、エラーの文言が消える
- [x] `MessageComposer` のフォームのクラスに `sticky` と `bottom-0` が含まれる

チャット画面の本体への組み込み（`src/components/chat-view.tsx`）

- [x] `ChatView` のボタンのうち、クラスに `bg-primary` を含むもの（主操作）が「送信」だけである
- [x] `ChatView` で送信に成功すると、応答のメッセージが一覧の末尾に描画される
- [x] 送信に成功した後に、同じ `id` の `message.created` のハンドラを呼んでも、そのメッセージが二重に描画されない
- [x] 同じ `id` の `message.created` を先に受け取った後に送信の応答が届いても、そのメッセージが二重に描画されない
- [x] `ChatView` の空状態で「メッセージを入力する」ボタンを押すと、投稿フォームの入力欄にフォーカスが移る

## 対象外

- メッセージの編集
- メッセージの削除（`docs/specs/message-delete.md` で扱う。`message.deleted` の受信もそちらで `ChatView` に足す）
- ページング（過去分の追加読み込み）。一覧は全件を返し、全件を描画する（`docs/specs/persistence.md` の `listByGroup` も全件）
- 既読・未読の管理、未読数、通知（ブラウザの通知・音など）
- 入力中の表示（タイピングインジケーター）、オンライン状態の表示
- 添付ファイル（画像・ファイルの送信）、絵文字のリアクション、メンション、リンクのプレビュー、Markdown などの書式
- 日付の区切りの表示、日付を含む時刻の表示（時刻は `HH:mm` だけ）、同じ投稿者の連続したメッセージをまとめる表示
- 上へスクロールして読んでいる間に新着が届いたことの表示（「新しいメッセージ」のボタンなど）
- 送信に失敗したメッセージの再送（失敗したら入力欄に本文を残すだけ）、送信前に一覧へ仮に表示すること（楽観的な更新）
- 下書きの保存（画面を離れると入力欄の値は消える）
- 入力欄の高さの自動調整
- チャット画面でのグループ名の変更・メンバーの変更・グループの削除の反映（`group.updated`・`group.deleted` の受信。`docs/specs/group-settings.md`・`docs/specs/group-members.md`・`docs/specs/group-delete.md` で扱う）
- グループ設定の画面（`/groups/[groupId]/settings`）の中身（`docs/specs/group-settings.md` で扱う。この仕様ではヘッダーにリンクだけを置く）
- 取り直しの応答を待っている間に `message.created` で足したメッセージを、取り直しの応答で置き換えたときに残すこと（応答で一覧を置き換える。取りこぼしは次の再接続で埋まる）
- ブラウザを使うE2Eテスト、実際のレイアウトでのスクロール位置の検査（jsdom で値を決めて確かめる）

## 関連

- Issue #141（この仕様書の下書き）、親Issue #133
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/group-message.md`（`postMessageToGroup`。メンバー以外は投稿できない）
- `docs/specs/data-model.md`（`Message` の `id`・`groupId`・`senderId`、`MESSAGE_MAX_LENGTH`、`createMessage` の文言、`DomainError`）
- `docs/specs/persistence.md`（`MessageRepository` の `insert`・`listByGroup`（`sentAt` の昇順）、`UserRepository.findById`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`・`requireCurrentUserInPage`、存在の秘匿、日時、`apiFetch`、Route Handler のテストの方法）
- `docs/specs/web-groups.md`（`findGroupAsMember`・`getGroupDetail`・`GroupMemberDetail`・`UNKNOWN_MEMBER_NAME`、作成からチャット画面への移動）
- `docs/specs/realtime-events.md`（`message.created` の内容と届け先、`publish`・`subscribe`、`useLiveEvents` と `onReconnect`、`MessageJson`、1タブ1接続、重複の表示を避ける）
- `docs/specs/ui-foundation.md`（チャット画面の導線（戻る・設定）、UI規約、主操作は1つ、`EmptyState`、フィードバック、投稿は成功のトーストを出さない、画面のテスト）
- `src/server/messages.ts`、`src/app/api/groups/[groupId]/messages/route.ts`
- `src/app/groups/[groupId]/page.tsx`、`src/components/chat-view.tsx`、`src/components/chat-header.tsx`、`src/components/message-list.tsx`、`src/components/message-composer.tsx`
