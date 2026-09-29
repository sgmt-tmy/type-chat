---
status: approved        # draft / approved / implemented / deprecated
updated: 2026-09-29
---

# グループ設定画面（グループ名の変更・オーナーの委譲）

## 目的

既存のドメイン機能「グループ名の変更」（`docs/specs/group-rename.md`、`renameGroup`）と「オーナー権限の委譲」（`docs/specs/group-transfer-owner.md`、`transferOwner`）を、APIとグループ設定画面（`/groups/[groupId]/settings`）から使えるようにする（親Issue #133）。
あわせて、チャット画面からグループ設定画面への導線と、グループ名の変更をチャット画面・設定画面へすぐ反映する仕組み（`group.updated`）を定める。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行う。グループ名の規則（トリム・空・50文字）とオーナーだけが操作できることは、ドメイン（`src/group.ts` の `renameGroup`・`transferOwner`）が検証する。メンバーかどうかは `findGroupAsMember`（`docs/specs/web-groups.md`）が検証する。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、成功の応答を名前つきのキーで包む）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループは、存在しないグループと同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」）。メンバーであってオーナーでない利用者の変更は、ドメインの `DomainError`（`forbidden`）のとおり 403 にする。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、確認ダイアログは取り消せない操作だけ、フィードバックの出し方、ポーリングしない）は `docs/specs/ui-foundation.md` に従う。グループ名の変更は確認なしで即時に反映し、オーナーの委譲だけ確認ダイアログを出す。
- イベントの種類・内容・届け先は `docs/specs/realtime-events.md` に従う。グループ名の変更・オーナーの委譲に成功したら、`group.updated` を「変更前のメンバーと変更後のメンバーの和」に発行する（どちらの操作もメンバーを変えないので、実際にはそのグループの `members` 全員。操作した本人を含む）。

### ユースケース（`src/server/groups.ts` に追加）

```ts
// GroupDetail は同じファイルで定義済み（docs/specs/web-groups.md）
import type { GroupRepository } from "../db/group-repository";
import type { UserRepository } from "../db/user-repository";

export async function renameGroupByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  name: string,
): Promise<GroupDetail>;

export async function transferOwnerByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  newOwnerId: string,
): Promise<GroupDetail>;
```

どちらも次の順に行う。

1. **ロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（グループがない・メンバーでないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）がそのまま伝わる）。
2. **ドメイン**:
   - `renameGroupByUser`: `renameGroup(group, userId, name)`。オーナーでなければ `forbidden`（`グループ名の変更はオーナーのみ可能です`）、トリム後が空・50文字超なら `validation`（`グループ名は空にできません`・`グループ名は50文字以内で入力してください`）。
   - `transferOwnerByUser`: `transferOwner(group, userId, newOwnerId)`。オーナーでなければ `forbidden`（`オーナー権限の委譲はオーナーのみ可能です`）、委譲先が自分なら `validation`（`委譲先が現在のオーナーと同じです`）、委譲先がメンバーでない（存在しない利用者を含む）なら `validation`（`委譲先はグループのメンバーである必要があります`）。
3. **保存**: `GroupRepository.save(<変更後のグループ>)` で保存する（`docs/specs/persistence.md`）。
4. **発行**: `publish({ type: "group.updated", data: { group: <変更後のグループ> } }, <変更前の members と変更後の members の和>)` を呼ぶ（`src/server/events.ts`）。
5. 変更後のグループを、`getGroupDetail` と同じ規則（`members` の順は参加順のまま、各IDを `UserRepository.findById` の `name` に置き換え、見つからなければ `UNKNOWN_MEMBER_NAME`）で `GroupDetail` にして返す。

- 1〜3のどこかで例外が投げられたら、それより後の手順を行わない（保存しない・発行しない）。
- `renameGroupByUser` は、変更後の名前が変更前と同じでも（`renameGroup` が受け付けるので）保存し、`group.updated` を発行する。変更がないときに送らないようにするのは画面の役目（「保存」を無効にする）。
- イベントの `data.group` は `Group`（`{ id, name, ownerId, members }`。メンバーの名前を含まない）。名前を含む `GroupDetail` はAPIの応答にだけ含める（`docs/specs/realtime-events.md` のイベントの形を変えない）。

### グループの変更のAPI

いずれも現在の利用者が必要（`requireCurrentUser`。いなければ 401）。Route Handler は `createGroupRepository(getDb())`・`createUserRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。`context.params` は Next.js（App Router）の動的なセグメントの値（`Promise`）。

#### `src/app/api/groups/[groupId]/route.ts`（`PATCH` を追加）

```ts
export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `PATCH /api/groups/[groupId]` | `{ "name": string }` | 200 `{ "group": { "id": string, "name": string, "ownerId": string, "members": [{ "id": string, "name": string }] } }` | 400（空・50文字超・本文の形式）、401、403（オーナーでない）、404（メンバーでない・存在しない） |

- `renameGroupByUser(groups, users, groupId, <現在の利用者のid>, name)` を呼ぶ。`name` はトリム後の名前になる。
- `name` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）にし、保存も発行もしない。
- `GET /api/groups/[groupId]`（`docs/specs/web-groups.md`）はそのまま残す。上の表と `GET` にないメソッドは Next.js の既定の 405 に任せる。

#### `src/app/api/groups/[groupId]/owner/route.ts`（新規）

```ts
export async function PUT(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `PUT /api/groups/[groupId]/owner` | `{ "userId": string }` | 200 `{ "group": { "id": string, "name": string, "ownerId": string, "members": [{ "id": string, "name": string }] } }`（`ownerId` が委譲先） | 400（委譲先が自分・メンバーでない、本文の形式）、401、403（オーナーでない）、404（メンバーでない・存在しない） |

- `transferOwnerByUser(groups, users, groupId, <現在の利用者のid>, userId)` を呼ぶ。
- `userId` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）にし、保存も発行もしない。
- 旧オーナーは委譲後もメンバーに残る（`docs/specs/group-transfer-owner.md`）。
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

### 画面

UI の規約は `docs/specs/ui-foundation.md` に従う。グループ設定画面の主操作は、オーナーに見せる「保存」ボタンだけにする（オーナーでない利用者には主操作がない）。

#### グループ設定画面（`/groups/[groupId]/settings`、`src/app/groups/[groupId]/settings/page.tsx`）

```tsx
export default async function GroupSettingsPage(props: {
  params: Promise<{ groupId: string }>;
}): Promise<React.JSX.Element>;
```

- Server Component。`requireCurrentUserInPage()` で現在の利用者を読む（いなければ `/start` へリダイレクトする。`docs/specs/web-api-foundation.md`）。
- `getGroupDetail(createGroupRepository(getDb()), createUserRepository(getDb()), groupId, <現在の利用者のid>)` でグループを取る。`DomainError`（`not_found`）が投げられたら（自分がメンバーでない・存在しない）、`next/navigation` の `notFound()` を呼ぶ（チャット画面と同じ。`docs/specs/web-chat.md`）。
- `GroupSettingsView` に、`groupId`・`currentUserId`（現在の利用者の `id`）・`initialGroup`（取った `GroupDetail`）を渡して描画する。

#### 設定画面の本体（`src/components/group-settings-view.tsx`）

```tsx
import type { GroupDetail } from "../server/groups";

export type GroupSettingsViewProps = {
  groupId: string;
  currentUserId: string;
  initialGroup: GroupDetail;
};

export function GroupSettingsView(props: GroupSettingsViewProps): React.JSX.Element;
```

Client Component。表示中のグループ（`GroupDetail`）を状態に持つ（初期値は `initialGroup`）。「オーナーである」とは、表示中のグループの `ownerId` が `currentUserId` と同じこと。

- 上から順に、次を描画する。
  - 「チャットに戻る」（`/groups/<groupId>` へのリンク。Next.js の `Link`。左向きの矢印のアイコンと文言「チャットに戻る」。主操作の見た目（`bg-primary`）にしない。`docs/specs/ui-foundation.md` の「画面一覧と導線」）
  - 見出し「グループ設定」（この画面のただ1つの `h1`）
  - セクション「グループ名」（`Card`。見出しは `h2`「グループ名」）
  - セクション「メンバー」（`Card`。見出しは `h2`「メンバー」）
- **セクション「グループ名」**:
  - オーナーなら、`RenameGroupForm`（`currentName` に表示中のグループの `name`）を描画する。`onRenamed` で受け取ったグループで、表示中のグループを置き換える。
  - オーナーでなければ、グループ名を文字（入力欄ではない）で出し、その下に `グループ名はオーナーだけが変更できます`（`text-muted-foreground`）を出す。入力欄と「保存」は描画しない。
- **セクション「メンバー」**: `MemberList`（`members`・`ownerId` に表示中のグループの値）を描画する。`onOwnerTransferred` で受け取ったグループで、表示中のグループを置き換える（委譲した後は「オーナーである」でなくなるので、セクション「グループ名」はオーナーでない利用者の表示に、メンバーの操作メニューは描画されなくなる）。
- **リアルタイム**: `useLiveEvents`（`docs/specs/realtime-events.md`）を、設定画面の中でこの部品だけが呼ぶ（1タブ1接続）。
  - `group.updated` を受け取ったら、`data.group.id` がこの画面の `groupId` と同じときだけ、`apiFetch<{ group: GroupDetail }>("/api/groups/<groupId>")` でグループを取り直す（イベントの `group` にはメンバーの名前がないため、名前を含む詳細を取り直す）。違えば何もしない。
  - `onReconnect` でもグループを取り直す（切断中の取りこぼしを埋める）。
  - 取り直しが成功したら、その応答で表示中のグループを置き換える。取り直しが重なったときは、最後に始めた取得の結果だけを反映する（古い応答で新しい表示を上書きしない）。取り直しが失敗したら、`toast.error(message)` を出し、表示中のグループを残す。
  - 一定間隔での取り直し（`setInterval`・`setTimeout` の繰り返し）はしない。
  - `group.deleted` の受信と、自分がメンバーから外されたときの扱いは、この仕様では持たない（`docs/specs/group-delete.md`・`docs/specs/group-members.md` で、この部品の `useLiveEvents` に足す）。

#### グループ名の変更フォーム（`src/components/rename-group-form.tsx`）

```tsx
import type { GroupDetail } from "../server/groups";

export const RENAME_GROUP_NAME_INPUT_ID = "rename-group-name";

export type RenameGroupFormProps = {
  groupId: string;
  currentName: string;
  onRenamed: (group: GroupDetail) => void;
};

export function RenameGroupForm(props: RenameGroupFormProps): React.JSX.Element;
```

Client Component。オーナーにだけ描画する（`GroupSettingsView` が判断する）。

- `form` 要素に、ラベル「グループ名」の入力欄（`id` は `RENAME_GROUP_NAME_INPUT_ID`、初期値は `currentName`）と、「保存」ボタン（`variant="default"`。設定画面の主操作。`type="submit"`）を置く。Enter キーでも送信できる。
- **変更がないときは無効**: 入力欄の値をトリムした後が `currentName` と同じ間は、「保存」を `disabled` にする（Enter でも送信しない）。
- **送信前の検査**（APIを呼ばない。`CreateGroupForm`（`docs/specs/web-groups.md`）と同じ）:
  - トリム後が空なら、入力欄の直下に `グループ名は空にできません` を出す。
  - トリム後が `GROUP_NAME_MAX_LENGTH`（50文字。`src/group.ts`）を超えたら、入力欄の直下に `グループ名は50文字以内で入力してください` を出す。
- 入力エラーを出している間は、入力欄に `aria-invalid="true"` を付け、`aria-describedby` でエラーの文言の要素を指す（`docs/specs/ui-foundation.md` の「フィードバック」）。入力欄の値を変えたら、エラーを消す。
- **送信**: 検査を通ったら `apiFetch<{ group: GroupDetail }>("/api/groups/<groupId>", { method: "PATCH", body: { name } })` を呼ぶ（`name` は入力欄の値のまま。トリムはサーバーが行う）。確認ダイアログは出さない（`docs/specs/ui-foundation.md`）。
  - 送信中は「保存」を `disabled` にし、文言を「保存中…」にする。
  - 成功したら `toast.success("グループ名を変更しました")` を出し、`onRenamed(<応答の group>)` を呼び、入力欄の値を応答の `group.name`（トリム後の名前）にする。
  - 失敗が `validation`・`conflict` のときは、APIの `message` を入力欄の直下に出す。それ以外の失敗（`forbidden`・`not_found`・`unauthenticated`・`network`・`internal` など）は `toast.error(message)` で出す。失敗したら「保存」の文言を戻し、入力欄の値は消さない。
- **外からの名前の変更**: `currentName` が変わったとき（別のタブ・別のオーナーによる変更を `GroupSettingsView` が取り直した場合など）、入力欄を編集していなければ（入力欄の値のトリム後が変更前の `currentName` と同じなら）入力欄の値を新しい `currentName` にする。編集中なら入力欄の値を残す。

#### メンバー一覧（`src/components/member-list.tsx`）

```tsx
import type { GroupDetail, GroupMemberDetail } from "../server/groups";

export type MemberListProps = {
  groupId: string;
  members: GroupMemberDetail[];
  ownerId: string;
  currentUserId: string;
  onOwnerTransferred: (group: GroupDetail) => void;
};

export function MemberList(props: MemberListProps): React.JSX.Element;
```

Client Component。

- **一覧**: `ul` 要素に、メンバーごとに1つの `li` を `members` の順（参加順）で並べる。各行は次のとおり。
  - メンバーの名前を出す。自分（`id` が `currentUserId`）の行は、名前の後に `（あなた）` を付ける（例: `たろう（あなた）`）。
  - `id` が `ownerId` の行にだけ、`Badge` で「オーナー」を出す。
- **操作メニュー**（自分がオーナー＝`currentUserId` が `ownerId` と同じときだけ）:
  - 自分以外の各行に、`DropdownMenu` のトリガーのアイコンボタン（`variant="ghost"`、`size="icon"`、横三点のアイコン、`aria-label` は `<名前>さんの操作`）を置く。自分の行には置かない。
  - メニューに「オーナーにする」の項目を置く。選ぶと、確認ダイアログ（`ConfirmDialog`。`docs/specs/ui-foundation.md`）を開く。
  - オーナーでない利用者には、どの行にも操作メニューを描画しない。
- **確認ダイアログ**（オーナーの委譲は取り消せない操作のため確認する。`docs/specs/ui-foundation.md`）:
  - `title`: `<名前>さんをオーナーにしますか？`
  - `description`: `委譲するとあなたはグループ名の変更やメンバーの追加ができなくなります。`
  - `confirmLabel`: `オーナーにする`、`pendingLabel`: `変更中…`、`destructive`: 指定しない（既定の `false`）
  - 確定ボタンを押すと、`apiFetch<{ group: GroupDetail }>("/api/groups/<groupId>/owner", { method: "PUT", body: { userId: <そのメンバーの id> } })` を呼ぶ。送信中は `pending` を `true` にする。
  - 成功したら、`toast.success("オーナーを<名前>さんに変更しました")` を出し、ダイアログを閉じ（`open` を `false`）、`onOwnerTransferred(<応答の group>)` を呼ぶ。
  - 失敗したら、`toast.error(message)` を出し、ダイアログを開いたままにする（`pending` は `false` に戻す）。
  - 「キャンセル」を押すと、APIを呼ばずにダイアログを閉じる。

### チャット画面の変更

チャット画面（`docs/specs/web-chat.md`）の部品を、次のとおり変える。

#### ヘッダー（`src/components/chat-header.tsx`）

- 右端の「設定」の文字のリンクを、設定画面へのアイコンボタンに置き換える。要素は `/groups/<groupId>/settings` への Next.js の `Link`（ページの移動なので `button` ではなくリンク。`docs/specs/ui-foundation.md` の「アクセシビリティ」）で、見た目は `Button` の `variant="ghost"`・`size="icon"`、中身は歯車のアイコン（lucide の `Settings`）だけにし、`aria-label="グループ設定"` を付ける。
- 主操作の見た目（`bg-primary`）にしない。それ以外（「戻る」、`h1` のグループ名）は `docs/specs/web-chat.md` のまま。
- この変更で `docs/specs/web-chat.md` の「ヘッダー」の記述と受け入れ条件（名前が「設定」のリンク）が変わるので、実装のPR（「設定画面とグループ名の変更」）で `docs/specs/web-chat.md` も同じPRで直す（`docs/README.md` の「仕様書のルール」3）。`docs/specs/ui-foundation.md` の「画面一覧と導線」の「設定」のリンクは、このアイコンボタン（リンクの名前は「グループ設定」）で満たす。

#### チャット画面の本体（`src/components/chat-view.tsx`）

- ヘッダーに出すグループ名を状態に持つ（初期値は `groupName`）。`ChatHeader` の `groupName` にはこの状態を渡す。
- `useLiveEvents` の `handlers` に `group.updated` を足す（`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）。
  - `data.group.id` がこの画面の `groupId` と同じなら、ヘッダーのグループ名を `data.group.name` にする。
  - 違えば何もしない（ストリームには、自分がメンバーのほかのグループのイベントも届く）。
- `group.updated` によるメンバーの変化（メンバーの追加・脱退、自分が外された場合）の扱いは、この仕様では持たない（`docs/specs/group-members.md` で扱う）。

### 追加・変更するファイル

| パス | 内容 | 実装の区分 |
| --- | --- | --- |
| `src/server/groups.ts` | `renameGroupByUser` を追加 | 設定画面とグループ名の変更 |
| `src/server/groups.ts` | `transferOwnerByUser` を追加 | メンバー一覧とオーナーの委譲 |
| `src/app/api/groups/[groupId]/route.ts` | `PATCH /api/groups/[groupId]` を追加 | 設定画面とグループ名の変更 |
| `src/app/api/groups/[groupId]/owner/route.ts` | `PUT /api/groups/[groupId]/owner`（新規） | メンバー一覧とオーナーの委譲 |
| `src/app/groups/[groupId]/settings/page.tsx` | グループ設定画面（新規） | 設定画面とグループ名の変更 |
| `src/components/group-settings-view.tsx` | 設定画面の本体（新規）。セクション「メンバー」（`MemberList` の組み込み）は「メンバー一覧とオーナーの委譲」で足す | 設定画面とグループ名の変更、メンバー一覧とオーナーの委譲 |
| `src/components/rename-group-form.tsx` | グループ名の変更フォーム（新規） | 設定画面とグループ名の変更 |
| `src/components/member-list.tsx` | メンバー一覧と委譲の操作（新規） | メンバー一覧とオーナーの委譲 |
| `src/components/chat-header.tsx` | 設定画面へのアイコンボタン（`aria-label="グループ設定"`） | 設定画面とグループ名の変更 |
| `src/components/chat-view.tsx` | `group.updated` でヘッダーのグループ名を更新 | 設定画面とグループ名の変更 |
| `docs/specs/web-chat.md` | 「ヘッダー」の記述と受け入れ条件を、アイコンボタンに合わせて直す | 設定画面とグループ名の変更 |

### テスト

- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。発行のテストは、`src/server/events.ts` の `subscribe` で購読し、最後に解除関数を呼ぶ（`docs/specs/realtime-events.md` の「テスト」）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。メンバーを増やすときは、`addMember` を適用したグループを `GroupRepository.save` で保存する。ハンドラには `{ params: Promise.resolve({ groupId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`apiFetch`（または `fetch`）、sonner の `toast`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。
- `src/app/groups/[groupId]/settings/page.tsx` のテストは、`requireCurrentUserInPage`・`getDb`（`createDb(":memory:")` のDB）・`next/navigation` の `notFound` を `vi.mock` で差し替え、`await GroupSettingsPage({ params: Promise.resolve({ groupId }) })` の結果を描画する。

## 受け入れ条件

### 設定画面とグループ名の変更（チャット画面からの導線と名前の反映を含む）

ユースケース（`src/server/groups.ts` の `renameGroupByUser`）

- [ ] オーナーが `renameGroupByUser(…, groupId, <オーナーのid>, "  新しい名前  ")` を呼ぶと、`name` が `新しい名前` で、`members` がメンバーの `{ id, name }` の `GroupDetail` が返る
- [ ] `renameGroupByUser` で変更した名前が、`findById` で取り出したグループの `name` に保存されている
- [ ] `renameGroupByUser` で変更すると、`subscribe` したメンバー全員（操作したオーナーを含む）のリスナーが、`type` が `group.updated`、`data.group.name` が変更後の名前のイベントで1回ずつ呼ばれる
- [ ] `renameGroupByUser` で変更しても、`subscribe` したメンバーでない利用者のリスナーは呼ばれない
- [ ] メンバーであってオーナーでない利用者が `renameGroupByUser` を呼ぶと、`code` が `"forbidden"`、文言が `グループ名の変更はオーナーのみ可能です` の `DomainError` が投げられ、名前が保存されず、イベントが発行されない
- [ ] メンバーでない利用者が `renameGroupByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ、イベントが発行されない
- [ ] `renameGroupByUser` に空白だけの名前を渡すと、`code` が `"validation"`、文言が `グループ名は空にできません` の `DomainError` が投げられ、名前が保存されず、イベントが発行されない
- [ ] `renameGroupByUser` に51文字の名前を渡すと、`code` が `"validation"`、文言が `グループ名は50文字以内で入力してください` の `DomainError` が投げられ、名前が保存されない

`PATCH /api/groups/[groupId]`

- [ ] オーナーで `PATCH /api/groups/[groupId]` に `{ name: "  新しい名前  " }` を送ると、200 と `{ group: { id, name: "新しい名前", ownerId, members: [{ id, name }] } }` が返り、その後の `GET /api/groups/[groupId]` の `name` が `新しい名前` である
- [ ] `PATCH` に成功すると、`subscribe` したメンバーのリスナーが、`data.group.id` がそのグループの `id` の `group.updated` のイベントで呼ばれる
- [ ] メンバーであってオーナーでない利用者で `PATCH` を呼ぶと、403（`code: "forbidden"`、`message: "グループ名の変更はオーナーのみ可能です"`）が返り、名前が変わらない
- [ ] メンバーでない利用者で `PATCH` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返り、名前が変わらない
- [ ] 存在しないID（UUID の形）で `PATCH` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [ ] `PATCH` に空白だけの名前を送ると、400（`code: "validation"`、`message: "グループ名は空にできません"`）が返る
- [ ] `PATCH` に51文字の名前を送ると、400（`code: "validation"`、`message: "グループ名は50文字以内で入力してください"`）が返る
- [ ] `PATCH` に `name` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返り、イベントが発行されない
- [ ] Cookie のない `Request` で `PATCH` を呼ぶと、401（`code: "unauthenticated"`）が返る

グループ設定画面（`src/app/groups/[groupId]/settings/page.tsx`）

- [ ] 利用者の Cookie がない状態で設定画面を描画すると、`redirect("/start")` が呼ばれる
- [ ] メンバーの利用者で設定画面を描画すると、`h1` が1つだけあり、その文言が「グループ設定」である
- [ ] メンバーでない利用者で設定画面を描画すると、`notFound()` が呼ばれる
- [ ] 存在しないグループIDで設定画面を描画すると、`notFound()` が呼ばれる

設定画面の本体（`src/components/group-settings-view.tsx`）

- [ ] `GroupSettingsView` に、名前が「チャットに戻る」で `href` が `/groups/<groupId>` のリンクがあり、そのクラスに `bg-primary` が含まれない
- [ ] `GroupSettingsView` に、`h2`「グループ名」と `h2`「メンバー」がある
- [ ] オーナーで `GroupSettingsView` を描画すると、ラベル「グループ名」の入力欄の値が現在のグループ名で、「保存」ボタンがある
- [ ] オーナーでない利用者で `GroupSettingsView` を描画すると、グループ名の文字と `グループ名はオーナーだけが変更できます` が出て、ラベル「グループ名」の入力欄と「保存」ボタンがない
- [ ] オーナーで描画した `GroupSettingsView` のボタンのうち、クラスに `bg-primary` を含むもの（主操作）が「保存」だけである
- [ ] オーナーでない利用者で描画した `GroupSettingsView` に、クラスに `bg-primary` を含むボタンがない
- [ ] `GroupSettingsView` で `useLiveEvents` が1回だけ使われる
- [ ] この画面の `groupId` の `group.updated` のハンドラを呼ぶと、`GET /api/groups/<groupId>` が呼ばれ、応答のグループ名が表示される
- [ ] 別の `groupId` の `group.updated` のハンドラを呼んでも、`GET /api/groups/<groupId>` が呼ばれない
- [ ] `onReconnect` を呼ぶと、`GET /api/groups/<groupId>` が呼ばれ、応答の内容が表示される
- [ ] 取り直しを2回続けて始め、2回目の応答が先に届いた後に1回目の応答が届いても、表示が2回目の応答の内容のままである
- [ ] 取り直しが失敗すると、`toast.error` がその `message` で呼ばれ、表示中のグループ名が残る
- [ ] `GroupSettingsView` でグループ名の変更に成功すると、応答のグループ名が表示に反映され、「保存」ボタンが無効に戻る
- [ ] `src/components/group-settings-view.tsx`・`src/components/rename-group-form.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

グループ名の変更フォーム（`src/components/rename-group-form.tsx`）

- [ ] `RenameGroupForm` の入力欄が、ラベル「グループ名」で取得でき、`id` が `RENAME_GROUP_NAME_INPUT_ID` で、値が `currentName` である
- [ ] 入力欄の値が `currentName` のままの間、「保存」ボタンが無効である
- [ ] 入力欄の値が `currentName` の前後に空白を足しただけの間、「保存」ボタンが無効である
- [ ] 入力欄の値を `currentName` と違う名前にすると、「保存」ボタンが有効になる
- [ ] 名前を変えて「保存」を押すと、`PATCH /api/groups/<groupId>` に `{ name }` が送られる
- [ ] 名前を変えて入力欄で Enter キーを押すと、`PATCH /api/groups/<groupId>` が送られる
- [ ] 送信中は「保存」ボタンが無効で、文言が「保存中…」になる
- [ ] 変更に成功すると、`toast.success("グループ名を変更しました")` が呼ばれ、`onRenamed` が応答の `group` で1回呼ばれる
- [ ] 空（空白だけを含む）にして送信すると、APIを呼ばずに入力欄の直下に `グループ名は空にできません` が出て、入力欄が `aria-invalid="true"` になり、`aria-describedby` がその文言の要素を指す
- [ ] 51文字の名前にして送信すると、APIを呼ばずに入力欄の直下に `グループ名は50文字以内で入力してください` が出る
- [ ] 入力エラーを出した後に入力欄の値を変えると、エラーの文言が消え、`aria-invalid` が外れる
- [ ] 変更が 400（`validation`）で失敗すると、APIの `message` が入力欄の直下に出て、`toast.error` が呼ばれない
- [ ] 変更が 403（`forbidden`）で失敗すると、`toast.error("グループ名の変更はオーナーのみ可能です")` が呼ばれ、`onRenamed` が呼ばれない
- [ ] 変更が失敗した後、「保存」ボタンの文言が「保存」に戻り、入力欄の値が残っている
- [ ] 入力欄を編集していない状態で `currentName` を別の名前にして再描画すると、入力欄の値が新しい `currentName` になる
- [ ] 入力欄を編集している状態で `currentName` を別の名前にして再描画すると、入力欄の値が編集中の値のまま残る

チャット画面からの導線と名前の反映（`src/components/chat-header.tsx`・`src/components/chat-view.tsx`）

- [ ] `ChatHeader` に、名前が「グループ設定」（`aria-label`）で `href` が `/groups/<groupId>/settings` のリンクがあり、その中に `svg`（アイコン）がある
- [ ] `ChatHeader` の「グループ設定」のリンクの文言（`textContent`）が空で、クラスに `bg-primary` が含まれない
- [ ] `ChatHeader` に、名前が「設定」のリンクがない
- [ ] `ChatView` で、この画面の `groupId` の `group.updated` のハンドラを呼ぶと、ヘッダーの `h1` の文言が `data.group.name` になる
- [ ] `ChatView` で、別の `groupId` の `group.updated` のハンドラを呼んでも、ヘッダーの `h1` の文言が変わらない
- [ ] `ChatView` で `group.updated` を受け取っても、`useLiveEvents` が1回だけ使われたままで、表示中のメッセージの一覧が残る

### メンバー一覧とオーナーの委譲

ユースケース（`src/server/groups.ts` の `transferOwnerByUser`）

- [ ] オーナーが `transferOwnerByUser(…, groupId, <オーナーのid>, <メンバーのid>)` を呼ぶと、`ownerId` がそのメンバーの `id` の `GroupDetail` が返る
- [ ] `transferOwnerByUser` の後、`findById` で取り出したグループの `ownerId` が委譲先で、旧オーナーが `members` に残っている
- [ ] `transferOwnerByUser` で委譲すると、`subscribe` したメンバー全員（旧オーナー・新オーナーを含む）のリスナーが、`type` が `group.updated`、`data.group.ownerId` が委譲先のイベントで1回ずつ呼ばれる
- [ ] メンバーであってオーナーでない利用者が `transferOwnerByUser` を呼ぶと、`code` が `"forbidden"`、文言が `オーナー権限の委譲はオーナーのみ可能です` の `DomainError` が投げられ、`ownerId` が変わらず、イベントが発行されない
- [ ] メンバーでない利用者が `transferOwnerByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられる
- [ ] `transferOwnerByUser` で委譲先に自分（現在のオーナー）を指定すると、`code` が `"validation"`、文言が `委譲先が現在のオーナーと同じです` の `DomainError` が投げられ、イベントが発行されない
- [ ] `transferOwnerByUser` で委譲先にメンバーでない利用者を指定すると、`code` が `"validation"`、文言が `委譲先はグループのメンバーである必要があります` の `DomainError` が投げられ、`ownerId` が変わらない

`PUT /api/groups/[groupId]/owner`

- [ ] オーナーで `PUT /api/groups/[groupId]/owner` に `{ userId: <メンバーのid> }` を送ると、200 と `{ group: { id, name, ownerId: <そのメンバーのid>, members: [{ id, name }] } }` が返る
- [ ] `PUT` に成功すると、`subscribe` したメンバーのリスナーが、`data.group.ownerId` が委譲先の `group.updated` のイベントで呼ばれる
- [ ] メンバーであってオーナーでない利用者で `PUT` を呼ぶと、403（`code: "forbidden"`、`message: "オーナー権限の委譲はオーナーのみ可能です"`）が返り、`ownerId` が変わらない
- [ ] メンバーでない利用者で `PUT` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [ ] 存在しないID（UUID の形）で `PUT` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [ ] `PUT` の `userId` に自分（現在のオーナー）を送ると、400（`code: "validation"`、`message: "委譲先が現在のオーナーと同じです"`）が返る
- [ ] `PUT` の `userId` にメンバーでない利用者を送ると、400（`code: "validation"`、`message: "委譲先はグループのメンバーである必要があります"`）が返る
- [ ] `PUT` に `userId` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返り、イベントが発行されない
- [ ] Cookie のない `Request` で `PUT` を呼ぶと、401（`code: "unauthenticated"`）が返る

メンバー一覧（`src/components/member-list.tsx`）

- [ ] `MemberList` にメンバーを3人渡すと、渡した順に3つの `li` が描画され、各行にメンバーの名前が出る
- [ ] `ownerId` のメンバーの行にだけ「オーナー」が出て、ほかの行には出ない
- [ ] `currentUserId` のメンバーの行にだけ、名前の後に `（あなた）` が出る
- [ ] オーナーで描画すると、自分以外の各行に `aria-label` が `<名前>さんの操作` のボタンがあり、自分の行にはない
- [ ] オーナーでない利用者で描画すると、`<名前>さんの操作` のボタンがどの行にもない
- [ ] `<名前>さんの操作` のボタンのクラスに `bg-primary` が含まれない
- [ ] 操作メニューを開くと「オーナーにする」の項目があり、選ぶと `alertdialog` に `<名前>さんをオーナーにしますか？` と `委譲するとあなたはグループ名の変更やメンバーの追加ができなくなります。` が出る
- [ ] 確認ダイアログの「キャンセル」を押すと、`PUT` が呼ばれずにダイアログが閉じる
- [ ] 確認ダイアログの「オーナーにする」を押すと、`PUT /api/groups/<groupId>/owner` に `{ userId: <そのメンバーのid> }` が送られる
- [ ] 送信中は、確認ダイアログの確定ボタンが無効で、文言が「変更中…」になる
- [ ] 委譲に成功すると、`toast.success("オーナーを<名前>さんに変更しました")` が呼ばれ、ダイアログが閉じ、`onOwnerTransferred` が応答の `group` で1回呼ばれる
- [ ] 委譲が失敗すると、`toast.error` がその `message` で呼ばれ、ダイアログが開いたままで、`onOwnerTransferred` が呼ばれない

設定画面への組み込み（`src/components/group-settings-view.tsx`）

- [ ] `GroupSettingsView` のセクション「メンバー」に、`initialGroup` のメンバーの名前が参加順に出る
- [ ] オーナーで描画した `GroupSettingsView` で委譲に成功すると、委譲先の行に「オーナー」が出て、自分の行から「オーナー」が消える
- [ ] 委譲に成功した後の `GroupSettingsView` では、ラベル「グループ名」の入力欄と「保存」ボタンがなくなり、`グループ名はオーナーだけが変更できます` が出る
- [ ] 委譲に成功した後の `GroupSettingsView` では、`<名前>さんの操作` のボタンがどの行にもない
- [ ] オーナーでない利用者で描画した `GroupSettingsView` で、自分への委譲の `group.updated` を受け取って取り直すと、ラベル「グループ名」の入力欄と「保存」ボタンが出て、自分以外の行に `<名前>さんの操作` のボタンが出る
- [ ] オーナーで描画した `GroupSettingsView` で、確認ダイアログを閉じた状態のボタンのうち、クラスに `bg-primary` を含むものが「保存」だけである
- [ ] `src/components/member-list.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

## 対象外

- グループ名の重複チェック（同じ名前のグループを何個でも作れる。`docs/specs/group-rename.md`・`docs/specs/web-groups.md` と同じ）
- グループ名の変更・オーナーの委譲の変更履歴（誰がいつ変えたかの記録・表示）と、その通知（ブラウザの通知・チャットへのシステムメッセージなど）
- 共同オーナー（複数人がオーナー権限を持つ）。オーナーは常に1人（`docs/specs/group-transfer-owner.md`）
- オーナーの委譲の取り消し（元に戻すには、新しいオーナーがもう一度委譲する）
- 委譲した後に旧オーナーをメンバーから自動で外すこと（旧オーナーはメンバーに残る。`docs/specs/group-transfer-owner.md`）
- メンバーの追加・脱退・外すこと（`docs/specs/group-members.md` で扱う）。`group.updated` によるメンバーの変化・自分が外されたときの設定画面・チャット画面の扱いも同じ
- グループの削除と `group.deleted` の受信（`docs/specs/group-delete.md` で扱う）
- グループの説明・アイコンなど、グループ名以外の設定項目
- 設定画面の読み込み中の表示（`Skeleton`）。設定画面は Server Component で取ったグループを初期値にして描画し、取り直しの間は表示中の内容を残す
- 取り直しの応答を待っている間に、変更・委譲の応答で表示を置き換えた場合の順序の保証（遅れて届いた取り直しの応答で置き換わることがある。次の `group.updated` か再接続で最新になる）
- ブラウザを使うE2Eテスト

## 関連

- Issue #142（この仕様書の下書き）、親Issue #133、前提の仕様書 #137（`ui-foundation.md`）・#138（`web-api-foundation.md`）・#139（`realtime-events.md`）
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/group-rename.md`（`renameGroup`。オーナー限定・トリム・50文字・重複チェックをしない）
- `docs/specs/group-transfer-owner.md`（`transferOwner`。オーナー限定・自分への委譲の禁止・委譲先はメンバー・旧オーナーはメンバーに残る・共同オーナーはない）
- `docs/specs/data-model.md`（`renameGroup`・`transferOwner` の `DomainError` の `code` と文言、`GROUP_NAME_MAX_LENGTH`）
- `docs/specs/persistence.md`（`GroupRepository.save`・`findById`、`UserRepository.findById`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`・`requireCurrentUserInPage`、存在の秘匿、`apiFetch`、Route Handler のテストの方法）
- `docs/specs/ui-foundation.md`（設定画面の位置づけと「チャットに戻る」の導線、主操作は1つ、確認ダイアログはオーナーの委譲を含む4つだけ、`ConfirmDialog`、フィードバック（「グループ名を変更しました」）、アイコンだけのボタン・リンクの `aria-label`、画面のテスト）
- `docs/specs/realtime-events.md`（`group.updated` の内容と届け先、`publish`・`subscribe`、`useLiveEvents` と `onReconnect`、1タブ1接続）
- `docs/specs/web-groups.md`（`findGroupAsMember`・`getGroupDetail`・`GroupDetail`・`GroupMemberDetail`・`UNKNOWN_MEMBER_NAME`、`GET /api/groups/[groupId]`、`CreateGroupForm` の入力エラーの出し方）
- `docs/specs/web-chat.md`（チャット画面の `ChatHeader`・`ChatView`。「設定」のリンクをこの仕様のアイコンボタンに置き換える）
- `src/server/groups.ts`、`src/app/api/groups/[groupId]/route.ts`、`src/app/api/groups/[groupId]/owner/route.ts`
- `src/app/groups/[groupId]/settings/page.tsx`、`src/components/group-settings-view.tsx`、`src/components/rename-group-form.tsx`、`src/components/member-list.tsx`、`src/components/chat-header.tsx`、`src/components/chat-view.tsx`
