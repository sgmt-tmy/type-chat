---
status: approved        # draft / approved / implemented / deprecated
updated: 2026-09-29
---

# 永続化（SQLite + Drizzle のスキーマとリポジトリ）

## 目的

ドメインの集約（`User`・`Group`・`Message`）を SQLite に保存し、ユースケース層（`src/server/`）が「リポジトリでロード → ドメインの純粋関数を適用 → リポジトリで保存」の形で使えるようにする。
技術選定（SQLite + Drizzle ORM、DBファイル `data/type-chat.db`、層構成）はリポジトリ側の ADR 0001（`docs/decisions/0001-web-app-stack.md`）に従う。集約の型（`Group.id`・`Message.id`・`Message.senderId`・`DomainError`）は `docs/specs/data-model.md` を前提にする。

## 入出力

### 共通の方針

- リポジトリはドメインの型（`User`・`Group`・`Message`）で受け渡しする。DBの行の型（Drizzle の推論型）はリポジトリの外に出さない。
- リポジトリはドメインの規則（名前の空文字・文字数、オーナー限定の操作など）を検証しない。検証はドメインの純粋関数が行い、リポジトリは渡された集約をそのまま保存する。
- ID はドメインで採番したもの（`crypto.randomUUID()`）をそのまま主キーにする。リポジトリは ID を採番しない。
- 日時の列は Drizzle の `integer(..., { mode: "timestamp_ms" })`（UNIX時刻のミリ秒）で保存し、`Date` で受け渡しする。
- `created_at`・`joined_at` はドメインの型に持たせない。リポジトリが行を挿入した時刻（`new Date()`）を入れる。
- リポジトリのメソッドは `Promise` を返す（SQLite ドライバの同期・非同期の違いを呼び出し側に出さないため）。
- 主キーの重複・外部キー違反など、DBの制約違反はドライバの例外をそのまま投げる（`DomainError` にしない）。

### SQLite ドライバ

- 推奨案は `better-sqlite3`（同期API、Drizzle の `drizzle-orm/better-sqlite3` で使える、ネイティブモジュール）。
- 最終決定は、依存を導入する実装タスクの gate で人が確認する。ドライバを変えても、この仕様の `createDb`・`getDb`・リポジトリのシグネチャは変えない（`Db` 型の中身だけが変わる）。

### テーブル（`src/db/schema.ts`）

Drizzle のスキーマ（`sqliteTable`）で次の4テーブルを定義する。

#### `users`

| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | text | 主キー |
| `name` | text | NOT NULL |
| `created_at` | integer（timestamp_ms） | NOT NULL |

- 利用者名（`name`）の一意性は DB の制約にしない（UNIQUE を付けない）。一意にするかどうか・その検証は `docs/specs/web-api-foundation.md` で扱う。

#### `groups`

| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | text | 主キー |
| `name` | text | NOT NULL |
| `owner_id` | text | NOT NULL |
| `created_at` | integer（timestamp_ms） | NOT NULL |

#### `group_members`

| 列 | 型 | 制約 |
| --- | --- | --- |
| `group_id` | text | NOT NULL。`groups.id` への外部キー、ON DELETE CASCADE |
| `user_id` | text | NOT NULL |
| `joined_at` | integer（timestamp_ms） | NOT NULL |

- 主キーは `(group_id, user_id)`（複合主キー）。

#### `messages`

| 列 | 型 | 制約 |
| --- | --- | --- |
| `id` | text | 主キー |
| `group_id` | text | NOT NULL。`groups.id` への外部キー、ON DELETE CASCADE |
| `sender_id` | text | NOT NULL |
| `text` | text | NOT NULL |
| `sent_at` | integer（timestamp_ms） | NOT NULL |

- `(group_id, sent_at)` の複合インデックスを張る（`listByGroup` のため）。

#### 外部キーの範囲

- 外部キーは `group_members.group_id` と `messages.group_id` の2つだけ（どちらも `groups.id` への ON DELETE CASCADE）。グループを削除すると、そのメンバーの行とメッセージの行も消える。
- `groups.owner_id`・`group_members.user_id`・`messages.sender_id` は `users` への外部キーにしない。ドメインの関数は利用者の存在を確認しないため、利用者が存在するかの確認はユースケース層で行う。

#### ドメインの型との対応

| ドメインの型 | テーブル | 対応 |
| --- | --- | --- |
| `User` の `id`・`name` | `users` | `id`・`name`。`created_at` は挿入時刻 |
| `Group` の `id`・`name`・`ownerId` | `groups` | `id`・`name`・`owner_id`。`created_at` は挿入時刻 |
| `Group` の `members` | `group_members` | 1メンバー＝1行。`joined_at` はその行を挿入した時刻 |
| `Message` の `id`・`groupId`・`senderId`・`text`・`sentAt` | `messages` | `id`・`group_id`・`sender_id`・`text`・`sent_at` |

- ロードした `Group` の `members` の順序は、`joined_at` の昇順（同じ時刻の行は挿入順）。リポジトリは `members` 配列の先頭から順に行を挿入するため、ドメインの関数（`addMember` は末尾に足し、`removeMember` は取り除くだけ）で作った `members` と同じ順序になる。

### DB接続（`src/db/client.ts`）

```ts
export const DB_FILE_PATH = "data/type-chat.db";

export type Db = /* Drizzle のDB型（ドライバで決まる。better-sqlite3 なら BetterSQLite3Database<typeof schema>） */;

export function createDb(filename: string): Db;
export function getDb(): Db;
```

- `createDb(filename)`
  - `filename` の SQLite DB を開き、Drizzle のDBを返す。`":memory:"` を渡すとメモリ上のDBを開く（テストで使う）。
  - 開いた直後に `PRAGMA foreign_keys = ON` を実行する（SQLite は既定で外部キーを検査しないため。ON DELETE CASCADE もこれがないと動かない）。
  - 続けて、`drizzle/` のマイグレーションを適用する（Drizzle の `migrate`）。適用済みのマイグレーションは再適用しない。
  - `filename` が `":memory:"` 以外で、親ディレクトリ（`data/` など）がなければ作る。
- `getDb()`
  - 初回の呼び出しで `createDb(DB_FILE_PATH)` を実行し、その結果を保持して返す。2回目以降は同じインスタンスを返す（シングルトン）。
  - パスは定数 `DB_FILE_PATH`（`data/type-chat.db`。プロセスの作業ディレクトリ＝リポジトリ直下からの相対パス）。環境変数は使わない（ADR 0001）。
  - テストでは `getDb()` を呼ばない（`data/type-chat.db` のファイルを作るため）。テストは `createDb(":memory:")` で作ったDBをリポジトリに差し込む。
- `data/type-chat.db` はコミットしない（`.gitignore` の `*.db` で除外済み）。

### マイグレーション

- マイグレーションは drizzle-kit で `src/db/schema.ts` から生成し、リポジトリ直下の `drizzle/` に置く（生成したSQLとメタデータをコミットする）。
- drizzle-kit の設定はリポジトリ直下の `drizzle.config.ts`（`dialect: "sqlite"`、`schema: "./src/db/schema.ts"`、`out: "./drizzle"`）。
- 生成のコマンドは `package.json` の scripts に `db:generate`（`drizzle-kit generate`）として足す。
- スキーマを変えたら、同じPRでマイグレーションを生成してコミットする。既存のマイグレーションファイルは書き換えない。

### リポジトリ

各リポジトリは、DBを受け取るファクトリ関数で作る（テストで `":memory:"` のDBを差し込めるようにするため）。

#### `src/db/group-repository.ts`

```ts
export type GroupRepository = {
  insert(group: Group): Promise<void>;
  findById(id: string): Promise<Group | null>;
  listByMember(userId: string): Promise<Group[]>;
  save(group: Group): Promise<void>;
  delete(id: string): Promise<boolean>;
};

export function createGroupRepository(db: Db): GroupRepository;
```

- `insert(group)`: `groups` に1行、`group_members` に `group.members` の各要素を1行ずつ、1つのトランザクションで挿入する。
- `findById(id)`: `id` のグループを、`members` を含めて返す。なければ `null`。
- `listByMember(userId)`: `userId` がメンバーに含まれるグループを、それぞれ `members` を含めて返す。順序は `groups.created_at` の昇順。1つもなければ空配列。
- `save(group)`: 既存のグループ（`group.id`）を、1つのトランザクションで `group` の内容に置き換える。
  - `groups` の `name`・`owner_id` を更新する。
  - `group_members` は、`group.members` にない行を削除し、`group.members` にあって行がないメンバーを配列の順に挿入する（`joined_at` は挿入時刻）。残るメンバーの行（`joined_at`）はそのまま保つ。
  - `group.id` のグループがなければ、`DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）を投げ、何も変更しない。
- `delete(id)`: `id` のグループを削除する。そのグループの `group_members`・`messages` の行は ON DELETE CASCADE で消える。削除した行があれば `true`、なければ `false` を返す（例外にしない）。

#### `src/db/message-repository.ts`

```ts
export type MessageRepository = {
  insert(message: Message): Promise<void>;
  listByGroup(groupId: string): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  delete(id: string): Promise<boolean>;
};

export function createMessageRepository(db: Db): MessageRepository;
```

- `insert(message)`: `messages` に1行挿入する。`message.groupId` のグループがなければ、外部キー違反の例外がそのまま投げられる。
- `listByGroup(groupId)`: `groupId` のメッセージを `sentAt` の昇順で返す。1つもなければ（グループがなくても）空配列。
- `findById(id)`: `id` のメッセージを返す。なければ `null`。
- `delete(id)`: `id` のメッセージを削除する。削除した行があれば `true`、なければ `false` を返す。

#### `src/db/user-repository.ts`

```ts
export type UserRepository = {
  insert(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  list(): Promise<User[]>;
};

export function createUserRepository(db: Db): UserRepository;
```

- `insert(user)`: `users` に1行挿入する。同じ `name` の利用者がいても挿入する（一意性はDBの制約にしない）。
- `findById(id)`: `id` の利用者を返す。なければ `null`。
- `list()`: すべての利用者を `created_at` の昇順（同じ時刻は挿入順）で返す。

### 追加・変更するファイル

| パス | 内容 |
| --- | --- |
| `src/db/schema.ts` | Drizzle のスキーマ（4テーブル・インデックス） |
| `src/db/client.ts` | `DB_FILE_PATH`・`Db`・`createDb`・`getDb` |
| `src/db/group-repository.ts` | `GroupRepository`・`createGroupRepository` |
| `src/db/message-repository.ts` | `MessageRepository`・`createMessageRepository` |
| `src/db/user-repository.ts` | `UserRepository`・`createUserRepository` |
| `drizzle.config.ts` | drizzle-kit の設定 |
| `drizzle/` | drizzle-kit が生成したマイグレーション |
| `package.json` | 依存（`drizzle-orm`・`drizzle-kit`・SQLite ドライバ）と `db:generate` スクリプトの追加 |

- テストは `src/db/*.test.ts` に置き、すべて `createDb(":memory:")` のDBで行う。

## 受け入れ条件

### DB接続とマイグレーション

- [ ] `createDb(":memory:")` で開いたDBに、`users`・`groups`・`group_members`・`messages` の4テーブルがある
- [ ] `createDb(":memory:")` で開いたDBで `PRAGMA foreign_keys` が `1`（有効）である
- [ ] `createDb(":memory:")` で開いたDBの `messages` に、`(group_id, sent_at)` のインデックスがある
- [ ] `createDb(":memory:")` を2回呼ぶと、互いに独立したDBが返る（片方に挿入した行がもう片方から見えない）

### UserRepository

- [ ] `insert` した `User` を `findById` で取り出すと、`id`・`name` が同じ `User` が返る
- [ ] 存在しない `id` で `findById` を呼ぶと `null` が返る
- [ ] 同じ `name` の `User` を2人 `insert` しても例外にならず、`list` で2人とも返る
- [ ] `list` が、`insert` した順に `User` を返す
- [ ] 1人も `insert` していないとき、`list` が空配列を返す

### GroupRepository

- [ ] `createGroup` で作った `Group` を `insert` し `findById` で取り出すと、`id`・`name`・`ownerId`・`members` が同じ `Group` が返る
- [ ] `addMember` を2回適用した `Group` を `insert` し `findById` で取り出すと、`members` が元の配列と同じ順序で返る
- [ ] 存在しない `id` で `findById` を呼ぶと `null` が返る
- [ ] `listByMember` が、その利用者がメンバーに含まれるグループだけを返す
- [ ] `listByMember` が、グループを `insert` した順に返す
- [ ] どのグループのメンバーでもない利用者で `listByMember` を呼ぶと、空配列が返る
- [ ] `renameGroup` を適用した `Group` を `save` すると、`findById` で新しい `name` が返る
- [ ] `transferOwner` を適用した `Group` を `save` すると、`findById` で新しい `ownerId` が返る
- [ ] `addMember` を適用した `Group` を `save` すると、`findById` の `members` の末尾に追加したメンバーが含まれる
- [ ] `removeMember` を適用した `Group` を `save` すると、`findById` の `members` から外したメンバーが消える
- [ ] 存在しない `id` の `Group` を `save` すると、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられる
- [ ] `delete` で存在するグループを削除すると `true` が返り、その後の `findById` が `null` を返す
- [ ] 存在しない `id` で `delete` を呼ぶと、例外にならず `false` が返る
- [ ] グループを `delete` すると、そのグループの `group_members` の行が消える（ON DELETE CASCADE）
- [ ] グループを `delete` すると、そのグループのメッセージが `listByGroup` で返らなくなる（ON DELETE CASCADE）

### MessageRepository

- [ ] `insert` した `Message` を `findById` で取り出すと、`id`・`groupId`・`senderId`・`text`・`sentAt`（ミリ秒まで）が同じ `Message` が返る
- [ ] 存在しない `id` で `findById` を呼ぶと `null` が返る
- [ ] `sentAt` の順と異なる順に `insert` した3件を、`listByGroup` が `sentAt` の昇順で返す
- [ ] `listByGroup` が、指定したグループのメッセージだけを返す（別のグループのメッセージを含まない）
- [ ] メッセージのないグループで `listByGroup` を呼ぶと、空配列が返る
- [ ] 存在しない `groupId` の `Message` を `insert` すると例外が投げられる（外部キー違反）
- [ ] `delete` で存在するメッセージを削除すると `true` が返り、その後の `findById` が `null` を返す
- [ ] 存在しない `id` で `delete` を呼ぶと、例外にならず `false` が返る

## 対象外

- ユースケース（`src/server/`）・API（`src/app/api/`）の仕様。リポジトリをどう組み合わせるか、`not_found` をどの操作で返すか、HTTP ステータスとの対応づけはそちらで扱う
- データの移行（既存データはない。最初のマイグレーションは空のDBから作る）
- 複数プロセスからの同時書き込み（ADR 0001 のとおり単一プロセス前提。WALモードや書き込みの競合の扱いも含めて扱わない）
- 利用者名の一意性（`docs/specs/web-api-foundation.md` で扱う）
- `users` への外部キー、利用者の削除
- メッセージの編集、ページング（`listByGroup` は全件を返す）
- `getDb()` の単体テスト（`data/type-chat.db` のファイルを作るため。API の実装・動作確認で確かめる）

## 関連

- Issue #136（この仕様書の下書き）、親Issue #133
- `docs/decisions/0001-web-app-stack.md`（SQLite + Drizzle ORM、`data/type-chat.db`、層構成、単一プロセス前提）
- `docs/specs/data-model.md`（`Group.id`・`Message.id`・`Message.senderId`・`DomainError` の `not_found`）
- `docs/specs/web-api-foundation.md`（利用者名の一意性。これから下書きする）
- `src/db/schema.ts`、`src/db/client.ts`、`src/db/group-repository.ts`、`src/db/message-repository.ts`、`src/db/user-repository.ts`、`drizzle.config.ts`、`drizzle/`
