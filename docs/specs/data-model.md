---
status: draft        # draft / approved / implemented / deprecated
updated: 2026-09-27
---

# データモデルの整備（IDの導入・投稿者ID・ドメインエラー）

## 目的

DB・APIを導入する前に、ドメインのデータモデルの穴を直す。
現状 `Group` に `id` がなく、`postMessageToGroup` が `createMessage(group.name, ...)` と呼ぶため `Message.groupId` の実体がグループ名になっている（グループ名を変えると過去のメッセージと結びつかなくなる）。`Message` にも `id` と投稿者ID（`senderId`）がない。
あわせて、API層がエラーを HTTP ステータスに対応づけられるよう、ドメインの例外に種別（`code`）を持たせる。

## 入出力

### 共通の方針

- `Group` と `Message` は、これまでどおり「集約を受け取り、新しい集約を返す純粋関数」と「不変更新（元のオブジェクトを変更しない）」のパターンを維持する。
- IDの採番は、`src/user.ts` の `createUser` と同じく `crypto.randomUUID()` で行う（UUID 形式の文字列）。
- 既存の例外のエラーメッセージの文言は変えない（既存テストの `toThrow("...")` がそのまま通ること）。

### ドメインエラー（`src/errors.ts`、新規）

```ts
export type DomainErrorCode = "validation" | "forbidden" | "not_found" | "conflict";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string);
}
```

- `DomainError` は `Error` のサブクラス。`name` は `"DomainError"`、`message` はコンストラクタに渡した文言、`code` は種別。
- `code` の意味（API層での HTTP ステータスへの対応づけは、API の仕様で決める）

| `code` | 意味 |
| --- | --- |
| `validation` | 入力値が規則を満たさない（空文字、文字数超過、指定できない相手など） |
| `forbidden` | 操作する権限がない（オーナー限定の操作をオーナー以外が行った、メンバー以外が投稿したなど） |
| `not_found` | 対象が存在しない。現在のドメイン関数は集約を直接受け取るため投げない。永続化・API層でIDから集約を探すときに使う |
| `conflict` | 対象の現在の状態と矛盾する操作（オーナーをメンバーから外すなど） |

- `src/group.ts`・`src/message.ts` が投げる例外は、すべて `DomainError` にする。

### グループ（`src/group.ts`）

```ts
export type Group = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
};

export const GROUP_NAME_MAX_LENGTH = 50;

export function createGroup(name: string, ownerId: string): Group;
export function addMember(group: Group, userId: string): Group;
export function removeMember(group: Group, userId: string): Group;
export function renameGroup(group: Group, requesterId: string, newName: string): Group;
export function transferOwner(group: Group, requesterId: string, newOwnerId: string): Group;
```

- `Group` に `id: string` を足す。
- `createGroup(name, ownerId)`
  - `id` を `crypto.randomUUID()` で採番する。
  - `name` をトリムし、空文字なら例外（既存どおり）。
  - トリム後の `name` が `GROUP_NAME_MAX_LENGTH`（50文字）を超えたら例外（新規。`renameGroup` と同じ規則・同じ文言）。
  - 戻り値は `{ id, name: トリム後の name, ownerId, members: [ownerId] }`。
- `addMember`・`removeMember`・`renameGroup`・`transferOwner` は、戻り値の `id` を元の `group.id` のまま保つ（スプレッドによる不変更新で `id` を引き継ぐ）。これら以外の振る舞いは変えない。

### メッセージ（`src/message.ts`）

```ts
export type Message = {
  id: string;
  groupId: string;
  senderId: string;
  text: string;
  sentAt: Date;
};

export const MESSAGE_MAX_LENGTH = 1000;

export function createMessage(
  groupId: string,
  senderId: string,
  text: string,
  sentAt?: Date,
): Message;

export function postMessageToGroup(
  group: Group,
  senderId: string,
  text: string,
  sentAt?: Date,
): Message;

export function sortMessagesByTime(messages: Message[]): Message[];
```

- `Message` に `id: string` と `senderId: string` を足す。
- `createMessage`
  - 引数の2番目に `senderId` を足す（`sentAt` は省略可のため末尾に残す）。
  - `id` を `crypto.randomUUID()` で採番する。
  - `text` のトリム・空文字チェック・`MESSAGE_MAX_LENGTH`（1000文字）の上限は既存どおり。
  - 戻り値は `{ id, groupId, senderId, text: トリム後の text, sentAt }`。
- `postMessageToGroup`
  - `senderId` が `group.members` に含まれなければ例外（既存どおり）。
  - メンバーであれば `createMessage(group.id, senderId, text, sentAt)` を呼ぶ。つまり `Message.groupId` に `group.id` を、`Message.senderId` に投稿者IDを設定する。
- `sortMessagesByTime` は変えない。

### エラーの種別

`src/group.ts`・`src/message.ts` の各例外に割り当てる `code`。文言は現在のものから変えない（`createGroup` の文字数超過だけが新規で、`renameGroup` と同じ文言）。

| 関数 | 条件 | 文言 | `code` |
| --- | --- | --- | --- |
| `createGroup` | トリム後の `name` が空 | `グループ名は空にできません` | `validation` |
| `createGroup` | トリム後の `name` が50文字超（新規） | `グループ名は50文字以内で入力してください` | `validation` |
| `removeMember` | `userId` がオーナー | `オーナーは削除できません` | `conflict` |
| `renameGroup` | `requesterId` がオーナーでない | `グループ名の変更はオーナーのみ可能です` | `forbidden` |
| `renameGroup` | トリム後の `newName` が空 | `グループ名は空にできません` | `validation` |
| `renameGroup` | トリム後の `newName` が50文字超 | `グループ名は50文字以内で入力してください` | `validation` |
| `transferOwner` | `requesterId` がオーナーでない | `オーナー権限の委譲はオーナーのみ可能です` | `forbidden` |
| `transferOwner` | `newOwnerId` が現在のオーナー | `委譲先が現在のオーナーと同じです` | `validation` |
| `transferOwner` | `newOwnerId` がメンバーでない | `委譲先はグループのメンバーである必要があります` | `validation` |
| `createMessage` | トリム後の `text` が空 | `メッセージは空にできません` | `validation` |
| `createMessage` | トリム後の `text` が1000文字超 | `メッセージは1000文字以内にしてください` | `validation` |
| `postMessageToGroup` | `senderId` がメンバーでない | `グループのメンバーではありません` | `forbidden` |

- `removeMember` のオーナー削除を `conflict` にするのは、`removeMember` が操作者を受け取らず、権限ではなく「対象がオーナーである」という現在の状態との矛盾で拒否するため（先に `transferOwner` で委譲すれば外せる）。
- `transferOwner` の委譲先の誤りを `validation` にするのは、操作者の権限は満たしたうえで、指定した値が委譲先として使えないため。
- `postMessageToGroup` で本文が空・文字数超過のときは、`createMessage` の `DomainError`（`validation`）がそのまま伝わる。

## 受け入れ条件

### DomainError

- [ ] `new DomainError("validation", "文言")` が `Error` と `DomainError` の両方のインスタンスである
- [ ] `new DomainError("forbidden", "文言")` の `code` が `"forbidden"`、`message` が `"文言"`、`name` が `"DomainError"` である

### Group の ID

- [ ] `createGroup` が返す `Group` の `id` が UUID 形式の文字列である
- [ ] `createGroup` を2回呼ぶと、異なる `id` の `Group` が返る
- [ ] `addMember` が返す `Group` の `id` が元の `group.id` と同じである
- [ ] `removeMember` が返す `Group` の `id` が元の `group.id` と同じである
- [ ] `renameGroup` が返す `Group` の `id` が元の `group.id` と同じである
- [ ] `transferOwner` が返す `Group` の `id` が元の `group.id` と同じである

### createGroup のグループ名の上限

- [ ] `createGroup` に `GROUP_NAME_MAX_LENGTH`（50文字）ちょうどの名前を渡すと、その名前の `Group` が返る
- [ ] `createGroup` に前後の空白を除いて50文字の名前を渡すと、トリムされた名前の `Group` が返る
- [ ] `createGroup` に51文字の名前を渡すと、`code` が `"validation"`、文言が `グループ名は50文字以内で入力してください` の `DomainError` が投げられる

### Message の ID と投稿者ID

- [ ] `createMessage(groupId, senderId, text)` が返す `Message` の `id` が UUID 形式の文字列である
- [ ] `createMessage` を2回呼ぶと、異なる `id` の `Message` が返る
- [ ] `createMessage` が返す `Message` の `groupId`・`senderId` が引数の値と同じである
- [ ] `postMessageToGroup` が返す `Message` の `groupId` が `group.id` と同じである
- [ ] `postMessageToGroup` が返す `Message` の `senderId` が引数の `senderId` と同じである
- [ ] `renameGroup` で名前を変えたグループに投稿しても、変更前と同じ `groupId`（`group.id`）の `Message` が返る

### エラーの種別

- [ ] `createGroup` にトリム後が空の名前を渡すと、`code` が `"validation"`、文言が `グループ名は空にできません` の `DomainError` が投げられる
- [ ] `removeMember` でオーナーを外そうとすると、`code` が `"conflict"`、文言が `オーナーは削除できません` の `DomainError` が投げられる
- [ ] `renameGroup` をオーナー以外が実行すると、`code` が `"forbidden"`、文言が `グループ名の変更はオーナーのみ可能です` の `DomainError` が投げられる
- [ ] `renameGroup` にトリム後が空の名前を渡すと、`code` が `"validation"`、文言が `グループ名は空にできません` の `DomainError` が投げられる
- [ ] `renameGroup` に51文字の名前を渡すと、`code` が `"validation"`、文言が `グループ名は50文字以内で入力してください` の `DomainError` が投げられる
- [ ] `transferOwner` をオーナー以外が実行すると、`code` が `"forbidden"`、文言が `オーナー権限の委譲はオーナーのみ可能です` の `DomainError` が投げられる
- [ ] `transferOwner` で委譲先に現在のオーナーを指定すると、`code` が `"validation"`、文言が `委譲先が現在のオーナーと同じです` の `DomainError` が投げられる
- [ ] `transferOwner` で委譲先にメンバーでないユーザーを指定すると、`code` が `"validation"`、文言が `委譲先はグループのメンバーである必要があります` の `DomainError` が投げられる
- [ ] `createMessage` にトリム後が空の本文を渡すと、`code` が `"validation"`、文言が `メッセージは空にできません` の `DomainError` が投げられる
- [ ] `createMessage` に1001文字の本文を渡すと、`code` が `"validation"`、文言が `メッセージは1000文字以内にしてください` の `DomainError` が投げられる
- [ ] `postMessageToGroup` をメンバーでないユーザーが実行すると、`code` が `"forbidden"`、文言が `グループのメンバーではありません` の `DomainError` が投げられる

## 対象外

- `addMember` の権限チェック（オーナー限定にすること。`docs/specs/group-members.md` で扱う）
- メッセージ・グループの削除
- 永続化（DB保存・IDからの検索。`docs/specs/persistence.md` で扱う）。`not_found` を実際に投げる処理もそちらで扱う
- `DomainError` の `code` と HTTP ステータスの対応づけ（API の仕様で扱う）
- `src/user.ts` の変更（`User` はすでに `id` を持つ。`createUser` の例外も `DomainError` にしない）

## 関連

- Issue #135（この仕様書の下書き）、親Issue #133、実装タスク #146
- `src/errors.ts`（新規。`DomainError`, `DomainErrorCode`）
- `src/group.ts`（`Group`, `GROUP_NAME_MAX_LENGTH`, `createGroup`, `addMember`, `removeMember`, `renameGroup`, `transferOwner`）
- `src/message.ts`（`Message`, `MESSAGE_MAX_LENGTH`, `createMessage`, `postMessageToGroup`, `sortMessagesByTime`）
- `src/user.ts`（`createUser` の `crypto.randomUUID()` による採番を踏襲する。変更はしない）
- `docs/specs/group-message.md`: 入出力の「`group.name` を暫定的にグループ識別子として扱う」記述と、「対象外」の「投稿者情報を `Message` 型に保持すること」「グループの識別子（ID）を `Group` 型に追加すること」を、この仕様で置き換える（`group-message.md` 自体の書き換えは実装タスク #146 で行う）
- `docs/specs/group-rename.md`（`GROUP_NAME_MAX_LENGTH` と文字数超過の文言の先例）
- `docs/specs/group-transfer-owner.md`（`transferOwner` の例外の先例）
