---
status: approved        # draft / approved / implemented / deprecated
updated: 2026-09-29
---

# グループの作成・一覧とホーム画面

## 目的

利用者が「グループでやり取りする」までの最短の導線として、ホーム画面（`/`）で自分のグループの一覧を見て、グループ名を入れて1回押すだけでグループを作り、そのままチャット画面へ進めるようにする（親Issue #133）。
あわせて、グループの作成・一覧・取得のAPIと、以後の機能が使う「メンバーとしてグループを取得する」ユースケースを定める。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行い、グループ名の規則はドメイン（`src/group.ts` の `createGroup`）が検証する。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、成功の応答を名前つきのキーで包む）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループは、存在しないグループと同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」）。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、フィードバックの出し方、読み込み中は Skeleton、空状態は `EmptyState`）は `docs/specs/ui-foundation.md` に従う。
- グループの作成はイベントを発行しない（`docs/specs/realtime-events.md`。作成時のメンバーは作成者だけで、作成した画面はAPIの応答で反映する）。

### ユースケース（`src/server/groups.ts`）

```ts
import type { Group } from "../group";
import type { GroupRepository } from "../db/group-repository";
import type { UserRepository } from "../db/user-repository";

/** 一覧の1行分 */
export type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
};

/** 詳細のメンバー1人分 */
export type GroupMemberDetail = { id: string; name: string };

/** メンバーの名前を含むグループの詳細 */
export type GroupDetail = {
  id: string;
  name: string;
  ownerId: string;
  members: GroupMemberDetail[];
};

export const UNKNOWN_MEMBER_NAME = "不明な利用者";

export async function createGroupByUser(groups: GroupRepository, userId: string, name: string): Promise<Group>;
export async function listGroupsOfUser(groups: GroupRepository, userId: string): Promise<GroupSummary[]>;
export async function findGroupAsMember(groups: GroupRepository, groupId: string, userId: string): Promise<Group>;
export async function getGroupDetail(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
): Promise<GroupDetail>;
```

- `createGroupByUser(groups, userId, name)`: `createGroup(name, userId)` でグループを作り（作成者がオーナー兼唯一のメンバー。名前のトリム・空・50文字超の検査は `createGroup` の `DomainError`）、`GroupRepository.insert` で保存して、そのグループを返す。`createGroup` が例外を投げたら保存しない。イベントは発行しない。
- `listGroupsOfUser(groups, userId)`: `GroupRepository.listByMember(userId)` の結果を、作成日時の新しい順にして `GroupSummary` の配列で返す。
  - `listByMember` は作成日時の古い順（`groups.created_at` の昇順、同じ時刻は挿入順。`docs/specs/persistence.md`）で返すので、それを逆順にする（リポジトリの仕様は変えない）。
  - `memberCount` は `group.members.length`。
  - どのグループのメンバーでもなければ空配列。
- `findGroupAsMember(groups, groupId, userId)`: `GroupRepository.findById(groupId)` のグループを返す。グループがないとき、または `userId` が `group.members` に含まれないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）を投げる（両者を区別しない）。
  - 以後の機能（メッセージの一覧・投稿、設定画面など）で、メンバーだけに許す操作の入口として使う。
- `getGroupDetail(groups, users, groupId, userId)`: `findGroupAsMember` でグループを取り（メンバーでなければ同じ `not_found`）、`members` の各IDを `UserRepository.findById` で名前に置き換えた `GroupDetail` を返す。
  - `members` の順序は `group.members` の順（参加順。`docs/specs/persistence.md`）のまま。
  - 利用者が見つからないメンバー（利用者の削除はないため通常は起きない）は、一覧から除かずに `name` を `UNKNOWN_MEMBER_NAME`（`不明な利用者`）にする。

### グループのAPI

いずれも現在の利用者が必要（`requireCurrentUser`。いなければ 401）。Route Handler は `createGroupRepository(getDb())`・`createUserRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。

#### `src/app/api/groups/route.ts`

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `GET /api/groups` | なし | 200 `{ "groups": [{ "id": string, "name": string, "ownerId": string, "memberCount": number }] }`（作成日時の新しい順） | 401 |
| `POST /api/groups` | `{ "name": string }` | 201 `{ "group": { "id": string, "name": string, "ownerId": string, "members": string[] } }` | 400（空・50文字超・本文の形式）、401 |

- `GET /api/groups` は、現在の利用者がメンバーのグループだけを返す（`listGroupsOfUser`）。
- `POST /api/groups` は、`createGroupByUser(groups, <現在の利用者のid>, name)` で作ったグループを返す。`ownerId` は現在の利用者の `id`、`members` は `[<現在の利用者のid>]`、`name` はトリム後の名前。
- `name` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）。
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

#### `src/app/api/groups/[groupId]/route.ts`

```ts
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `GET /api/groups/[groupId]` | なし | 200 `{ "group": { "id": string, "name": string, "ownerId": string, "members": [{ "id": string, "name": string }] } }` | 401、404 |

- `getGroupDetail` で取得する。自分がメンバーでないグループと、存在しないID（UUID の形でない値を含む）は、同じ 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする。
- `context.params` は Next.js（App Router）の動的なセグメントの値（`Promise`）。
- 上の表にないメソッドは Next.js の既定の 405 に任せる（変更・削除は `docs/specs/group-settings.md`・`docs/specs/group-delete.md` などで足す）。

### 画面

UI の規約は `docs/specs/ui-foundation.md` に従う。ホーム（`/`）の主操作は作成フォームの「作成」ボタンだけにする。

#### ホーム（`/`、`src/app/page.tsx`）

- Server Component。`requireCurrentUserInPage()` で現在の利用者を読む（いなければ `/start` へリダイレクトする。`docs/specs/web-api-foundation.md`）。
- 上から順に、`h1`「グループ」、`CreateGroupForm`、`GroupList`（`currentUserId` に現在の利用者の `id`）を描画する。
- 土台の段階の仮のページ（`docs/specs/ui-foundation.md`）を置き換える。

#### 作成フォーム（`src/components/create-group-form.tsx`）

```tsx
export const CREATE_GROUP_NAME_INPUT_ID = "create-group-name";

export function CreateGroupForm(): React.JSX.Element;
```

Client Component。

- `form` 要素に、ラベル「グループ名」の入力欄（`id` は `CREATE_GROUP_NAME_INPUT_ID`）と、「作成」ボタン（`variant="default"`。ホームの主操作）を置く。Enter キーでも送信できる。
- 送信前の検査（APIを呼ばない）:
  - トリム後が空なら、入力欄の直下に `グループ名は空にできません` を出す。
  - トリム後が `GROUP_NAME_MAX_LENGTH`（50文字。`src/group.ts`）を超えたら、入力欄の直下に `グループ名は50文字以内で入力してください` を出す。
- 入力エラーを出している間は、入力欄に `aria-invalid="true"` を付け、`aria-describedby` でエラーの文言の要素を指す（`docs/specs/ui-foundation.md` の「フィードバック」）。入力欄の値を変えたら、エラーを消す。
- 検査を通ったら `apiFetch("/api/groups", { method: "POST", body: { name } })` を呼ぶ（`name` は入力欄の値のまま。トリムはサーバーが行う）。送信中は「作成」を `disabled` にし、文言を「作成中…」にする。
- 成功したら `toast.success("グループを作成しました")` を出し、`router.push("/groups/<作成したグループの id>")` でチャット画面へ移動する。途中に確認や別の画面を挟まない（`docs/specs/ui-foundation.md` の「画面一覧と導線」）。
- 失敗が `validation`・`conflict` のときは、APIの `message` を入力欄の直下に出す。それ以外の失敗（`unauthenticated`・`network`・`internal` など）は `toast.error(message)` で出す。失敗したら「作成」の文言を戻し、入力欄の値は消さない。

#### グループ一覧（`src/components/group-list.tsx`）

```tsx
export type GroupListProps = { currentUserId: string };

export function GroupList(props: GroupListProps): React.JSX.Element;
```

Client Component。

- **取得**: マウントしたときに `apiFetch<{ groups: GroupSummary[] }>("/api/groups")` で一覧を取得する（`GroupSummary` は `src/server/groups.ts` から `import type` で読み込む）。
- **読み込み中**: 最初の取得が終わるまで、一覧の行の形に合わせた `Skeleton` を3行分描画し、一覧の領域に `aria-busy="true"` を付ける。一覧・空状態は描画しない。
- **一覧**: `ul` 要素に、グループごとに1つの `li` を並べる（API の順＝作成日時の新しい順）。各行は次のとおり。
  - 行全体を、`/groups/<グループの id>` への1つのリンク（Next.js の `Link`）にする。
  - グループ名と、メンバー数（`メンバー <memberCount>人`、`text-muted-foreground`）を出す。
  - `ownerId` が `currentUserId` と同じ行にだけ、`Badge` で「オーナー」を出す。
- **空状態**: 取得に成功して0件なら、`EmptyState` を描画する。
  - `title`: `まだグループがありません`
  - `description`: `グループ名を入力して、最初のグループを作りましょう`
  - `action`: 「グループ名を入力する」ボタン（`variant="outline"`。主操作ではない）。押すと、`document.getElementById(CREATE_GROUP_NAME_INPUT_ID)` の入力欄にフォーカスを移す。
- **取得の失敗**: `toast.error(message)` を出す。すでに一覧を表示していれば、その一覧を残す。最初の取得が失敗したときは、`EmptyState`（`title`: `グループを読み込めませんでした`、`description`: `接続を確認して、もう一度お試しください`、`action`: 「再読み込み」ボタン（`variant="outline"`。押すと取り直す））を描画する。
- **リアルタイム**: `useLiveEvents`（`docs/specs/realtime-events.md`）を、ホームの中でこの部品だけが呼ぶ（1タブ1接続）。
  - `group.updated`・`group.deleted` を受け取ったら、一覧を取り直す（`GET /api/groups`）。
  - `onReconnect` でも一覧を取り直す（切断中の取りこぼしを埋める）。
  - 取り直しの間は `Skeleton` に戻さず、表示中の一覧を残す。取り直しが重なったときは、最後に始めた取得の結果だけを反映する（古い応答で新しい一覧を上書きしない）。
  - 一定間隔での取り直し（`setInterval`・`setTimeout` の繰り返し）はしない。

### 追加・変更するファイル

| パス | 内容 | 実装の区分 |
| --- | --- | --- |
| `src/server/groups.ts` | グループの作成・自分のグループ一覧・メンバーとしての取得・詳細のユースケース | API |
| `src/app/api/groups/route.ts` | `GET`・`POST /api/groups` | API |
| `src/app/api/groups/[groupId]/route.ts` | `GET /api/groups/[groupId]` | API |
| `src/app/page.tsx` | ホーム画面（仮のページを置き換える） | ホーム画面 |
| `src/components/group-list.tsx` | グループ一覧（取得・空状態・リアルタイムでの取り直し） | ホーム画面 |
| `src/components/create-group-form.tsx` | グループの作成フォーム | ホーム画面 |

### テスト

- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `POST /api/users` か `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。`[groupId]` のハンドラには `{ params: Promise.resolve({ groupId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`next/navigation` の `useRouter`、`apiFetch`（または `fetch`）、sonner の `toast`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。
- `src/app/page.tsx` のテストは、`requireCurrentUserInPage` を `vi.mock` で差し替え、`await HomePage()` の結果を描画する。

## 受け入れ条件

### API

ユースケース（`src/server/groups.ts`）

- [x] `createGroupByUser(groups, "u1", "  雑談  ")` が、`name` が `雑談`、`ownerId` が `u1`、`members` が `["u1"]` のグループを返し、`findById` でそのグループが取り出せる
- [x] `createGroupByUser` に空白だけの名前を渡すと、`code` が `"validation"`、文言が `グループ名は空にできません` の `DomainError` が投げられ、グループが保存されない
- [x] `createGroupByUser` に51文字の名前を渡すと、`code` が `"validation"`、文言が `グループ名は50文字以内で入力してください` の `DomainError` が投げられ、グループが保存されない
- [x] `createGroupByUser` を呼んでも、`subscribe` した作成者のリスナーが呼ばれない（イベントを発行しない）
- [x] `listGroupsOfUser` が、その利用者がメンバーのグループだけを返す
- [x] グループを A・B・C の順に作ると、`listGroupsOfUser` が C・B・A の順に返す
- [x] `listGroupsOfUser` の各要素の `memberCount` が、そのグループの `members` の数である
- [x] どのグループのメンバーでもない利用者で `listGroupsOfUser` を呼ぶと、空配列が返る
- [x] `findGroupAsMember` にメンバーの利用者IDを渡すと、そのグループが返る
- [x] `findGroupAsMember` にメンバーでない利用者IDを渡すと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられる
- [x] `findGroupAsMember` に存在しないグループIDを渡すと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられる
- [x] `getGroupDetail` が、`members` を参加順の `{ id, name }`（利用者の名前）の配列にした詳細を返す
- [x] 利用者が存在しないメンバーを含むグループで `getGroupDetail` を呼ぶと、そのメンバーの `name` が `不明な利用者` になる
- [x] `getGroupDetail` にメンバーでない利用者IDを渡すと、`code` が `"not_found"` の `DomainError` が投げられる

`GET`・`POST /api/groups`

- [x] `POST /api/groups` に `{ name: "  雑談  " }` を送ると、201 と `{ group: { id, name: "雑談", ownerId: <現在の利用者のid>, members: [<現在の利用者のid>] } }` が返る
- [x] `POST /api/groups` で作ったグループが、同じ利用者の `GET /api/groups` に含まれる
- [x] `POST /api/groups` に空白だけの名前を送ると、400（`code: "validation"`、`message: "グループ名は空にできません"`）が返り、グループが増えない
- [x] `POST /api/groups` に51文字の名前を送ると、400（`code: "validation"`、`message: "グループ名は50文字以内で入力してください"`）が返り、グループが増えない
- [x] `POST /api/groups` に `name` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返る
- [x] Cookie のない `Request` で `POST /api/groups` を呼ぶと、401（`code: "unauthenticated"`）が返り、グループが増えない
- [x] どのグループのメンバーでもない利用者で `GET /api/groups` を呼ぶと、200 と `{ groups: [] }` が返る
- [x] `GET /api/groups` が、自分がメンバーのグループだけを返し、ほかの利用者だけがメンバーのグループを含まない
- [x] `GET /api/groups` が、グループを作成日時の新しい順に返す
- [x] `GET /api/groups` の各要素が `id`・`name`・`ownerId`・`memberCount` を持つ
- [x] Cookie のない `Request` で `GET /api/groups` を呼ぶと、401（`code: "unauthenticated"`）が返る

`GET /api/groups/[groupId]`

- [x] メンバーの利用者で `GET /api/groups/[groupId]` を呼ぶと、200 と `{ group: { id, name, ownerId, members: [{ id, name }] } }` が返り、`members` にメンバーの利用者名が含まれる
- [x] メンバーでない利用者で `GET /api/groups/[groupId]` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [x] 存在しないID（UUID の形）で `GET /api/groups/[groupId]` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [x] メンバーでない利用者への応答と、存在しないIDへの応答の、ステータスと本文が同じである
- [x] Cookie のない `Request` で `GET /api/groups/[groupId]` を呼ぶと、401（`code: "unauthenticated"`）が返る

### ホーム画面

ホーム（`src/app/page.tsx`）

- [ ] 利用者の Cookie がない状態でホームを描画すると、`redirect("/start")` が呼ばれる
- [ ] 利用者がいる状態でホームを描画すると、`h1`「グループ」が1つだけあり、「グループ名」の入力欄と「作成」ボタンがある
- [ ] ホームのボタンのうち、クラスに `bg-primary` を含むもの（主操作）が「作成」だけである（一覧が空の状態で確かめる）

作成フォーム（`src/components/create-group-form.tsx`）

- [ ] `CreateGroupForm` の入力欄が、ラベル「グループ名」で取得でき、`id` が `CREATE_GROUP_NAME_INPUT_ID` である
- [ ] `CreateGroupForm` でグループ名を入れて「作成」を押すと、`POST /api/groups` に `{ name }` が送られる
- [ ] `CreateGroupForm` の入力欄で Enter キーを押すと、`POST /api/groups` が送られる
- [ ] `CreateGroupForm` の送信中は「作成」ボタンが無効で、文言が「作成中…」になる
- [ ] `CreateGroupForm` の作成が成功すると、`toast.success("グループを作成しました")` が呼ばれ、`router.push("/groups/<作成したグループの id>")` が呼ばれる
- [ ] `CreateGroupForm` を空（空白だけを含む）のまま送信すると、APIを呼ばずに入力欄の直下に `グループ名は空にできません` が出て、入力欄が `aria-invalid="true"` になる
- [ ] `CreateGroupForm` に51文字の名前を入れて送信すると、APIを呼ばずに入力欄の直下に `グループ名は50文字以内で入力してください` が出て、入力欄が `aria-invalid="true"` になる
- [ ] 入力エラーを出している間、入力欄の `aria-describedby` がエラーの文言の要素を指す
- [ ] 入力エラーを出した後に入力欄の値を変えると、エラーの文言が消え、`aria-invalid` が外れる
- [ ] `CreateGroupForm` の作成が 400（`validation`）で失敗すると、APIの `message` が入力欄の直下に出る
- [ ] `CreateGroupForm` の作成が通信エラーで失敗すると、`toast.error` がその `message` で呼ばれ、入力欄の直下にはエラーが出ず、`router.push` は呼ばれない
- [ ] `CreateGroupForm` の作成が失敗した後、「作成」ボタンの文言が「作成」に戻り、入力欄の値が残っている

グループ一覧（`src/components/group-list.tsx`）

- [ ] `GroupList` をマウントすると、`GET /api/groups` が1回呼ばれる
- [ ] `GroupList` の最初の取得が終わるまで、`Skeleton` が描画され、一覧の領域が `aria-busy="true"` で、「まだグループがありません」は描画されない
- [ ] `GroupList` がグループを2件受け取ると、API の順に2つの行が描画され、各行にグループ名と `メンバー <memberCount>人` が出る
- [ ] `GroupList` の各行が、`href` が `/groups/<グループの id>` のリンクで、リンクの名前にグループ名が含まれる
- [ ] `ownerId` が `currentUserId` と同じ行にだけ「オーナー」が出て、ほかの行には出ない
- [ ] `GroupList` が0件を受け取ると、`h2`「まだグループがありません」と `グループ名を入力して、最初のグループを作りましょう` が描画される
- [ ] 空状態の「グループ名を入力する」ボタンを押すと、`CreateGroupForm` の入力欄にフォーカスが移る（`CreateGroupForm` と `GroupList` を一緒に描画して確かめる）
- [ ] 空状態の「グループ名を入力する」ボタンのクラスに `bg-primary` が含まれない
- [ ] `GroupList` の最初の取得が失敗すると、`toast.error` がその `message` で呼ばれ、`グループを読み込めませんでした` と「再読み込み」ボタンが描画される
- [ ] 「再読み込み」ボタンを押すと、`GET /api/groups` がもう1回呼ばれ、成功すれば一覧が描画される
- [ ] `group.updated` のハンドラを呼ぶと、`GET /api/groups` がもう1回呼ばれ、新しい応答の一覧が描画される
- [ ] `group.deleted` のハンドラを呼ぶと、`GET /api/groups` がもう1回呼ばれ、新しい応答で消えたグループの行が描画されなくなる
- [ ] `onReconnect` を呼ぶと、`GET /api/groups` がもう1回呼ばれる
- [ ] 取り直しの応答を待っている間、表示中の一覧が残り、`Skeleton` に戻らない
- [ ] 取り直しを2回続けて始め、2回目の応答が先に届いた後に1回目の応答が届いても、一覧が2回目の応答の内容のままである
- [ ] 取り直しが失敗すると、`toast.error` がその `message` で呼ばれ、表示中の一覧が残る
- [ ] `src/components/group-list.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

## 対象外

- グループの検索、一覧の並び替えの変更（作成日時の新しい順だけ）
- 未読数、最新メッセージ（本文・日時）の一覧への表示
- 一覧のページング（自分がメンバーのグループを全件返す）
- グループ名の変更・オーナーの委譲・メンバーの追加・脱退・グループの削除（`docs/specs/group-settings.md`・`docs/specs/group-members.md`・`docs/specs/group-delete.md` で扱う）
- グループ名の重複の検査（同じ名前のグループを何個でも作れる）
- 作成時に作成者以外のメンバーを指定すること
- グループの作成のイベントの発行（`docs/specs/realtime-events.md`）
- チャット画面（`/groups/[groupId]`）の中身（`docs/specs/web-chat.md` で扱う）
- 利用者の削除（`不明な利用者` の表示は、利用者が見つからない場合の保険）

## 関連

- Issue #140（この仕様書の下書き）、親Issue #133、実装タスク #154（API）・#155（ホーム画面）
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/data-model.md`（`Group`・`createGroup`・`GROUP_NAME_MAX_LENGTH`・`DomainError`）
- `docs/specs/persistence.md`（`GroupRepository` の `insert`・`findById`・`listByMember` の順序、`UserRepository.findById`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`・`requireCurrentUserInPage`、存在の秘匿、`apiFetch`、Route Handler のテストの方法）
- `docs/specs/ui-foundation.md`（ホームの位置づけ、作成からチャットまでの導線、UI規約、`EmptyState`、フィードバック、画面のテスト）
- `docs/specs/realtime-events.md`（`group.updated`・`group.deleted`、`useLiveEvents` と `onReconnect`、1タブ1接続、作成はイベントを発行しない）
- `src/server/groups.ts`、`src/app/api/groups/route.ts`、`src/app/api/groups/[groupId]/route.ts`
- `src/app/page.tsx`、`src/components/group-list.tsx`、`src/components/create-group-form.tsx`
