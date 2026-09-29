---
status: implemented       # draft / approved / implemented / deprecated
updated: 2026-09-29
---

# SSE によるリアルタイム配信

## 目的

新着メッセージとグループの変更を、開いている画面にすぐ反映する。定期的な再取得（ポーリング）ではなく、Server-Sent Events（SSE）でサーバーからクライアントへ配信する（ADR 0001）。
この仕様では、配信するイベントの種類と内容・届け先、プロセス内のイベントバス、配信のエンドポイント、クライアントのフックを定める。イベントの種類はここですべて定義し、以後の機能（メッセージの投稿・削除、グループの変更・削除）は、ここで定義した種類を `publish` で発行するだけにする。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。イベントバスは `src/server/events.ts`、配信のエンドポイントは `src/app/api/events/route.ts`、クライアントのフックは `src/components/use-live-events.ts` に置く。
- **利用者単位のストリーム1本**（1タブ1接続）にする。グループごと・画面の部品ごとにストリームを開かない（HTTP/1.1 の同一オリジンへの同時接続数の制限に当たらないようにするため。ADR 0001）。1本のストリームで、その利用者に届け先が含まれるイベントをすべて配る。
- **単一プロセス内**で配る。別のプロセスで起きた変更は届かない（ADR 0001）。
- **ポーリングしない。** クライアントに一定間隔での再取得（`setInterval`・`setTimeout` の繰り返しなど）を書かない。サーバーが一定間隔で送るコメント行（`: ping`）は接続の維持のためで、データの再取得ではない。
- 利用者の識別は `docs/specs/web-api-foundation.md` に従う（Cookie の利用者ID、`requireCurrentUser`、401 の応答）。
- JSON の日時は ISO 8601 の文字列にする（`docs/specs/web-api-foundation.md` の「日時」）。

### イベントの種類と内容

| 種類（`event:` の値） | `data` の内容 | 発行するとき | 届け先 |
| --- | --- | --- | --- |
| `message.created` | `{ groupId, message }` | メッセージを投稿したとき | 投稿した時点のグループのメンバー |
| `message.deleted` | `{ groupId, messageId }` | メッセージを削除したとき | 削除した時点のグループのメンバー |
| `group.updated` | `{ group }` | グループ名の変更、オーナーの委譲、メンバーの追加、メンバーの脱退 | 変更前のメンバーと変更後のメンバーの和 |
| `group.deleted` | `{ groupId }` | グループを削除したとき | 削除した時点のグループのメンバー |

- `message` は `Message`（`docs/specs/data-model.md`）を JSON にした形（`{ id, groupId, senderId, text, sentAt }`、`sentAt` は ISO 8601 の文字列）。
- `group` は変更後の `Group`（`{ id, name, ownerId, members }`）。
- 届け先には、操作した本人も含む（本人の別のタブにも反映するため）。操作した画面は、APIの応答と同じ内容のイベントを受け取ることになるので、同じ `id` のメッセージ・グループを重複して表示しないようにする（各画面の仕様で扱う）。
- `group.updated` を受け取ったクライアントは、自分（現在の利用者）が `group.members` に含まれなければ、そのグループを一覧から外す（脱退した・外された場合）。含まれていれば、そのグループを一覧に反映する（追加された場合は一覧に加える）。
- グループの作成はイベントを発行しない（作成時のメンバーは作成者だけで、作成した画面はAPIの応答で反映する）。

### 発行する側の約束

- イベントを発行するのはユースケース（`src/server/`）だけ。変更を保存し終えてから `publish` を呼ぶ。保存に失敗したら（例外が投げられたら）発行しない。
- 届け先の利用者IDの一覧は、発行する側が上の表に従って作る。どのユースケースがどのイベントを発行し、届け先が正しいかの受け入れ条件は、各機能の仕様（`docs/specs/web-chat.md`・`docs/specs/group-settings.md`・`docs/specs/group-members.md`・`docs/specs/message-delete.md`・`docs/specs/group-delete.md`）で扱う。
- 5種類目のイベントが必要になったら、この仕様を先に変更する。

### イベントバス（`src/server/events.ts`）

```ts
import type { Group } from "../group";
import type { Message } from "../message";

export type LiveEventPayloads = {
  "message.created": { groupId: string; message: Message };
  "message.deleted": { groupId: string; messageId: string };
  "group.updated": { group: Group };
  "group.deleted": { groupId: string };
};

export type LiveEventType = keyof LiveEventPayloads;

export type LiveEvent = {
  [K in LiveEventType]: { type: K; data: LiveEventPayloads[K] };
}[LiveEventType];

export type LiveEventListener = (event: LiveEvent) => void;

export type EventBus = {
  publish(event: LiveEvent, recipientUserIds: readonly string[]): void;
  subscribe(userId: string, listener: LiveEventListener): () => void;
  countSubscribers(userId: string): number;
};

export const LIVE_EVENT_TYPES: readonly LiveEventType[]; // 上の表の4種類
export const SSE_PING = ": ping\n\n";
export const SSE_PING_INTERVAL_MS = 25000;

export function createEventBus(): EventBus;

/** プロセスで1つのイベントバス（globalThis に置く）に対する操作 */
export function publish(event: LiveEvent, recipientUserIds: readonly string[]): void;
export function subscribe(userId: string, listener: LiveEventListener): () => void;
export function countSubscribers(userId: string): number;

/** SSE のイベント1つ分の文字列 */
export function formatSseEvent(event: LiveEvent): string;
```

- `createEventBus()`: 互いに独立したイベントバスを作る。購読者は、利用者IDごとのリスナーの集合で持つ。
  - `subscribe(userId, listener)`: `userId` の購読者として `listener` を登録し、解除関数を返す。同じ利用者が複数回購読できる（複数のタブ）。解除関数は何度呼んでもよく、2回目以降は何もしない（ほかの購読を解除しない）。
  - `publish(event, recipientUserIds)`: `recipientUserIds` の各利用者の購読者すべてに、`event` を同期的に渡す。`recipientUserIds` に同じIDが重複していても、1つの購読者に渡すのは1回だけ。購読者のいない利用者は無視する。リスナーが例外を投げても、`console.error` に出してほかのリスナーへの配信を続け、`publish` は例外を投げない。
  - `countSubscribers(userId)`: `userId` の購読者の数（テストと動作確認のため）。
- モジュールの `publish`・`subscribe`・`countSubscribers` は、`globalThis` に置いた1つのイベントバス（初回に `createEventBus()` で作る）に対して操作する。モジュールのトップレベルの変数にしないのは、Next.js がモジュールを Route Handler ごと・開発時の再読み込みごとに別に評価することがあり、別の Route Handler から `publish` したイベントが `/api/events` の購読者に届かなくなるのを防ぐため。
- `formatSseEvent(event)`: `event: <event.type>\ndata: <JSON.stringify(event.data)>\n\n` を返す。`JSON.stringify` は改行を `\n` にエスケープするので、`data:` 行は常に1行になる。`Message.sentAt`（`Date`）は ISO 8601 の文字列になる。
- `id:` 行・`retry:` 行は送らない（`Last-Event-ID` による再送は対象外）。

### 配信のエンドポイント（`src/app/api/events/route.ts`）

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response>;
```

- `GET /api/events`。動的（キャッシュしない）で、Node.js ランタイムで動かす（長時間の接続を保つため。ADR 0001）。
- 処理全体を `handleApi` で包み、`requireCurrentUser(request, createUserRepository(getDb()))` で現在の利用者を読む。利用者を識別できなければ 401（`code: "unauthenticated"`、`message: "利用を開始してください"`）の JSON を返し、購読しない（`docs/specs/web-api-foundation.md`）。
- 利用者がいれば、`ReadableStream<Uint8Array>` を本文にした 200 の応答を返す。ヘッダーは次のとおり。

| ヘッダー | 値 |
| --- | --- |
| `Content-Type` | `text/event-stream; charset=utf-8` |
| `Cache-Control` | `no-cache, no-transform` |

- ストリームを開いたら、`subscribe(user.id, listener)` で購読する。`listener` は受け取ったイベントを `formatSseEvent` で文字列にし、UTF-8 にしてストリームに書き込む。
- 接続の維持: `SSE_PING_INTERVAL_MS`（25秒）ごとに `SSE_PING`（`: ping\n\n`、コメント行）を書き込む。クライアントの `EventSource` はコメント行をイベントとして扱わない。
- 後始末: 次のどれかが起きたら、購読を解除し、接続の維持のタイマーを止め、ストリームを閉じる。後始末は1回だけ行い、2回目以降は何もしない。後始末の後はストリームに書き込まない。
  - `request.signal` が abort された（クライアントの切断）
  - ストリームが `cancel` された
  - 応答を返す時点で `request.signal` がすでに abort されていた
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

### クライアントのフック（`src/components/use-live-events.ts`）

```ts
import type { LiveEventPayloads, LiveEventType } from "../server/events";
import type { Message } from "../message";

/** JSON で受け取った Message（sentAt は ISO 8601 の文字列） */
export type MessageJson = Omit<Message, "sentAt"> & { sentAt: string };

export type LiveEventJsonPayloads = {
  "message.created": { groupId: string; message: MessageJson };
  "message.deleted": LiveEventPayloads["message.deleted"];
  "group.updated": LiveEventPayloads["group.updated"];
  "group.deleted": LiveEventPayloads["group.deleted"];
};

export type LiveEventHandlers = {
  [K in LiveEventType]?: (data: LiveEventJsonPayloads[K]) => void;
};

export type UseLiveEventsOptions = {
  handlers: LiveEventHandlers;
  onReconnect?: () => void;
};

export function useLiveEvents(options: UseLiveEventsOptions): void;
```

- Client Component から使う React フック。`src/server/events.ts` からは型だけを読み込む（`import type`）。サーバーのモジュールをクライアントのバンドルに含めない。
- マウントしたときに `new EventSource("/api/events")` で1本接続する（同一オリジンなので Cookie が送られる）。アンマウントしたときに `close()` する。
- 4種類のイベントそれぞれに `addEventListener` し、受け取った `data` を `JSON.parse` して、その種類のハンドラ（`handlers[<種類>]`）に渡す。
  - その種類のハンドラがなければ何もしない。
  - `data` が JSON として読めなければ、ハンドラを呼ばずに `console.error` に出す（例外を投げない）。
- `handlers` と `onReconnect` は最新の値を ref に持って呼ぶ。再描画で `options` が変わっても、接続を張り直さない。
- 再接続: 接続が切れると、`EventSource` が自動で再接続する（`error` の後に再び `open`）。**2回目以降の `open`**（最初の接続の `open` ではない）で `onReconnect` を1回呼ぶ。各画面は `onReconnect` で最新の状態を1回取り直し、切断中の取りこぼしを埋める（`Last-Event-ID` による再送はしない）。
- `EventSource` が閉じた（401 などで `readyState` が `CLOSED` になった）ときは、フックは接続を作り直さない。
- 1つの画面（ページ）で `useLiveEvents` を呼ぶのは1か所だけにする（1タブ1接続）。複数の部品がイベントを使うときは、画面の上位の部品で受けて渡す。
- このフックに、一定間隔の処理（`setInterval`・`setTimeout`）を書かない。

### 追加・変更するファイル

| パス | 内容 |
| --- | --- |
| `src/server/events.ts` | イベントの型、`createEventBus`、`publish`・`subscribe`・`countSubscribers`、`formatSseEvent`、`SSE_PING`・`SSE_PING_INTERVAL_MS` |
| `src/app/api/events/route.ts` | `GET /api/events`（SSE のストリーム） |
| `src/components/use-live-events.ts` | `useLiveEvents` |

### テスト

- `src/server/events.test.ts`: イベントバスは `createEventBus()` で作ったものでテストする（テストどうしで購読者を共有しないため）。`globalThis` のイベントバスを使うテストは、最後に解除関数を呼ぶ。
- `src/app/api/events/route.test.ts`: `docs/specs/web-api-foundation.md` の「テスト」と同じく、`getDb` を `createDb(":memory:")` のDBに `vi.mock` で差し替え、`AbortController` の `signal` を付けた `Request` で `GET` を直接呼ぶ。本文は `response.body.getReader()` で読み、`TextDecoder` で文字列にする。接続の維持は `vi.useFakeTimers()` で時間を進めて確かめる。
- `src/components/use-live-events.test.tsx`: jsdom には `EventSource` がないので、`vi.stubGlobal("EventSource", ...)` で、イベントを手で発火できる偽物に差し替え、`@testing-library/react` の `renderHook` でテストする。

## 受け入れ条件

### イベントバス（`src/server/events.ts`）

- [x] `subscribe("A", listener)` の後に `publish(event, ["A"])` を呼ぶと、`listener` が `event` を引数に1回呼ばれる
- [x] `subscribe("A", listener)` の後に `publish(event, ["B"])` を呼ぶと、`listener` は呼ばれない
- [x] `subscribe` が返した解除関数を呼んだ後に `publish(event, ["A"])` を呼ぶと、`listener` は呼ばれない
- [x] 同じ利用者 `A` で2回 `subscribe` すると、`publish(event, ["A"])` で2つのリスナーがどちらも1回ずつ呼ばれる
- [x] `publish(event, ["A", "A"])` を呼ぶと、`A` のリスナーは1回だけ呼ばれる
- [x] `publish(event, [])` を呼んでも例外にならず、どのリスナーも呼ばれない
- [x] 例外を投げるリスナーと投げないリスナーが同じ利用者にあるとき、`publish` は例外を投げず、投げないリスナーも呼ばれる
- [x] 解除関数を2回呼んでも例外にならず、同じ利用者のほかの購読は解除されない
- [x] `countSubscribers("A")` が、`A` の購読の数（購読のたびに1増え、解除のたびに1減る）を返す
- [x] `createEventBus()` で作った2つのイベントバスは独立している（片方で `publish` しても、もう片方のリスナーは呼ばれない）
- [x] `vi.resetModules()` の前に読み込んだモジュールの `subscribe` で購読し、後に読み込み直したモジュールの `publish` で発行すると、リスナーが呼ばれる（`globalThis` の1つのイベントバスを使う）
- [x] `LIVE_EVENT_TYPES` が `message.created`・`message.deleted`・`group.updated`・`group.deleted` の4つだけを含む
- [x] `formatSseEvent` に `group.deleted` のイベントを渡すと、`event: group.deleted\ndata: {"groupId":"<id>"}\n\n` が返る
- [x] `formatSseEvent` に `sentAt` が `new Date("2026-09-28T12:34:56.789Z")` の `message.created` のイベントを渡すと、`data:` の JSON の `message.sentAt` が `"2026-09-28T12:34:56.789Z"` である
- [x] `formatSseEvent` に本文が改行を含む `message.created` のイベントを渡すと、返る文字列の `data:` で始まる行が1行だけである

### 配信のエンドポイント（`src/app/api/events/route.ts`）

- [x] Cookie のない `Request` で `GET` を呼ぶと、401（`code: "unauthenticated"`）の JSON が返り、購読が増えない
- [x] 登録済みの利用者の Cookie を付けた `Request` で `GET` を呼ぶと、200 が返り、`Content-Type` が `text/event-stream` で始まり、`Cache-Control` が `no-cache, no-transform` である
- [x] `GET` の後、`countSubscribers(<その利用者のid>)` が1になる
- [x] `GET` の後に `publish` でその利用者に `message.created` を発行すると、本文から `formatSseEvent` と同じ文字列が読める
- [x] 別の利用者だけに発行したイベントは本文に現れず、その後にその利用者に発行したイベントが最初に読める
- [x] `vi.useFakeTimers()` で25秒進めると、本文から `: ping\n\n` が読める
- [x] `request` の `AbortController` を abort すると、`countSubscribers(<その利用者のid>)` が0になり、本文の読み取りが終わる（`done: true`）
- [x] abort した後に時間を25秒進めても例外にならず、本文に何も書き込まれない（接続の維持のタイマーが止まっている）
- [x] ストリームを `cancel` すると、`countSubscribers(<その利用者のid>)` が0になる
- [x] ルートのモジュールが `dynamic` を `"force-dynamic"`、`runtime` を `"nodejs"` としてエクスポートしている

### クライアントのフック（`src/components/use-live-events.ts`）

- [x] `useLiveEvents` を使うフックをマウントすると、`EventSource` が `"/api/events"` で1回だけ作られる
- [x] 4種類のイベントそれぞれについて、その種類のイベントを発火すると、その種類のハンドラだけが `data` を `JSON.parse` した値で1回呼ばれる
- [x] `message.created` のハンドラが受け取る `message.sentAt` が文字列のままである（`Date` に変換しない）
- [x] ハンドラを渡していない種類のイベントを発火しても、例外にならない
- [x] `data` が JSON でないイベントを発火すると、ハンドラが呼ばれず、例外にならない
- [x] 最初の `open` を発火しても、`onReconnect` は呼ばれない
- [x] 最初の `open` の後に `error`、`open` の順に発火すると、`onReconnect` が1回呼ばれる
- [x] 再接続を2回（`error`→`open` を2回）発火すると、`onReconnect` が2回呼ばれる
- [x] 別のハンドラを渡して再描画しても、`EventSource` は新しく作られず、イベントを発火すると新しいハンドラが呼ばれる
- [x] アンマウントすると、`EventSource` の `close` が呼ばれる
- [x] `src/components/use-live-events.ts` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

## 対象外

- 複数プロセス・複数台の間の配信（Redis の pub/sub など）。単一プロセス前提（ADR 0001）。必要になったら新しいADRで判断する
- `Last-Event-ID` による取りこぼしの再送（`id:` 行を送らない）。取りこぼしは `onReconnect` での取り直しで埋める
- 既読・未読の管理、通知（ブラウザの通知・未読数のバッジ・音など）
- 入力中の表示（タイピングインジケーター）、オンライン状態の表示
- グループの作成の配信（作成した画面はAPIの応答で反映する）
- `EventSource` が閉じた後（401 など）の接続の作り直し。利用者の切り替えは画面の移動で行う（`docs/specs/web-api-foundation.md`）
- 各ユースケースがどのイベントをどの届け先に発行するかのテスト（各機能の仕様で扱う）
- 接続数の上限、利用者ごとの接続数の制限
- リバースプロキシのバッファリング対策（`X-Accel-Buffering` など）。公開環境では運用しない（ADR 0001）
- ブラウザを使ったE2Eテスト（`docs/specs/ui-foundation.md`）

## 関連

- Issue #139（この仕様書の下書き）、親Issue #133、実装タスク #153
- `docs/decisions/0001-web-app-stack.md`（SSE を選んだ理由、ポーリングを使わない判断、単一プロセスのイベントバス、1タブ1接続、Node.js の常駐プロセスで動かす）
- `docs/specs/web-api-foundation.md`（`requireCurrentUser`・`handleApi`・401 の応答、日時の表現、Route Handler のテストの方法）
- `docs/specs/persistence.md`（`createUserRepository`・`getDb`・`createDb(":memory:")`）
- `docs/specs/data-model.md`（`Group`・`Message` の形）
- `docs/specs/ui-foundation.md`（ポーリングの禁止、規約テスト、画面のテストの環境）
- イベントを発行・購読する機能の仕様: `docs/specs/web-groups.md`・`docs/specs/web-chat.md`・`docs/specs/group-settings.md`・`docs/specs/group-members.md`・`docs/specs/message-delete.md`・`docs/specs/group-delete.md`（これから下書きする）
- `src/server/events.ts`、`src/app/api/events/route.ts`、`src/components/use-live-events.ts`
