---
status: draft        # draft / approved / implemented / deprecated
updated: 2026-09-28
---

# メンバーの追加（オーナー限定）と自己脱退

## 目的

現在の `addMember` には呼び出し元の権限の検査がなく、誰でもメンバーを追加できる。メンバーの追加をオーナーだけに許し、あわせてメンバーが自分でグループから抜ける「脱退」を定める（親Issue #133）。
ドメイン・ユースケース・API・グループ設定画面（`/groups/[groupId]/settings`）の各層で、メンバーの追加と自己脱退を使えるようにし、変化を `group.updated` で関係する画面へすぐ反映する。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行う。メンバーの追加がオーナーだけに許されること、オーナーが脱退できないことは、ドメイン（`src/group.ts` の `addMember`・`leaveGroup`）が検証する。メンバーかどうかは `findGroupAsMember`（`docs/specs/web-groups.md`）が検証する。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、成功の応答を名前つきのキーで包む、本文のない成功は 204）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループは、存在しないグループと同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」）。メンバーであってオーナーでない利用者の追加と、オーナーの脱退は、ドメインの `DomainError`（`forbidden`）のとおり 403 にする。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、確認ダイアログは取り消せない操作だけ、フィードバックの出し方、ポーリングしない）は `docs/specs/ui-foundation.md` に従う。メンバーの追加は確認なしで即時に反映し、グループからの脱退だけ確認ダイアログを出す。
- イベントの種類・内容・届け先は `docs/specs/realtime-events.md` に従う。メンバーの追加・脱退に成功したら、`group.updated` を「変更前のメンバーと変更後のメンバーの和」に発行する。追加では変更後のメンバー（追加された人を含む）、脱退では変更前のメンバー（脱退した本人を含む）になる。
- **脱退できるのは本人だけ**にする。オーナーがほかのメンバーを外す「除名」は、この仕様では扱わない（「対象外」）。

### ドメイン（`src/group.ts`）

```ts
export function addMember(group: Group, requesterId: string, userId: string): Group;
export function leaveGroup(group: Group, requesterId: string): Group;
```

- `addMember(group, requesterId, userId)`（引数に `requesterId` を足す。既存の `addMember(group, userId)` を置き換える）
  - `requesterId` が `group.ownerId` でなければ、`DomainError`（`code: "forbidden"`、文言 `メンバーの追加はオーナーのみ可能です`）を投げる。この検査を最初に行う（`userId` がすでにメンバーでも、オーナーでなければ投げる）。
  - `userId` がすでに `group.members` に含まれていれば、元の `group` をそのまま（同じオブジェクトを）返す（既存の挙動を維持）。
  - それ以外は、`members` の末尾に `userId` を足した新しい `Group` を返す。`id`・`name`・`ownerId` は元のまま。元の `group` は変更しない。
  - 利用者が存在するかは検査しない（ドメインの関数は利用者の存在を確認しない。`docs/specs/persistence.md`）。ユースケースで検査する。
- `leaveGroup(group, requesterId)`（新規）
  - `requesterId` が `group.members` に含まれなければ、`DomainError`（`code: "not_found"`、文言 `グループのメンバーではありません`）を投げる。
  - `requesterId` が `group.ownerId` なら、`DomainError`（`code: "forbidden"`、文言 `オーナーは脱退できません。先にオーナーを委譲してください`）を投げる。
  - それ以外は、`members` から `requesterId` を除いた新しい `Group` を返す。残るメンバーの順序、`id`・`name`・`ownerId` は元のまま。元の `group` は変更しない。
- `removeMember(group, userId)` は変えない（オーナーを外そうとすると `conflict`。`docs/specs/data-model.md`）。この仕様の画面・APIからは使わない。

| 関数 | 条件 | 文言 | `code` |
| --- | --- | --- | --- |
| `addMember` | `requesterId` がオーナーでない | `メンバーの追加はオーナーのみ可能です` | `forbidden` |
| `leaveGroup` | `requesterId` がメンバーでない | `グループのメンバーではありません` | `not_found` |
| `leaveGroup` | `requesterId` がオーナー | `オーナーは脱退できません。先にオーナーを委譲してください` | `forbidden` |

- `leaveGroup` のメンバーでない場合を `not_found` にするのは、脱退する対象（自分の所属）が存在しないため。APIからは `findGroupAsMember` が先に `not_found`（`グループが見つかりません`）を投げるので、この文言は画面に出ない。
- オーナーの脱退を `forbidden` にするのは、操作した本人（オーナー）にはその操作が許されないため（`removeMember` の `conflict` は、操作者を受け取らず対象の状態で拒否する場合）。
- `addMember` の引数が変わるので、既存の呼び出し（`src/group.test.ts` など、テストを含む）は第2引数にオーナーのIDを渡すように直す。`docs/specs/data-model.md` の `addMember` のシグネチャと「エラーの種別」の表も、実装のPRで合わせて直す（`docs/README.md` の「仕様書のルール」3）。

### ユースケース（`src/server/groups.ts` に追加）

```ts
// GroupDetail は同じファイルで定義済み（docs/specs/web-groups.md）
import type { GroupRepository } from "../db/group-repository";
import type { UserRepository } from "../db/user-repository";

export async function addMemberByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  memberUserId: string,
): Promise<GroupDetail>;

export async function leaveGroupByUser(
  groups: GroupRepository,
  groupId: string,
  userId: string,
): Promise<void>;
```

`addMemberByUser`（`userId` は操作した利用者、`memberUserId` は追加する利用者）は次の順に行う。

1. **ロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（グループがない・メンバーでないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）がそのまま伝わる）。
2. **ドメイン**: `addMember(group, userId, memberUserId)`。オーナーでなければ `forbidden`（`メンバーの追加はオーナーのみ可能です`）。
3. **利用者の確認**: `UserRepository.findById(memberUserId)` が `null` なら、`DomainError`（`code: "not_found"`、文言 `利用者が見つかりません`）を投げる（文言は `findUserToSwitch` と同じ。`docs/specs/web-api-foundation.md`）。
4. **変化がないとき**: 2 の戻り値が元の `group` と同じ（すでにメンバー）なら、保存も発行もせず、6 に進む。
5. **保存と発行**: `GroupRepository.save(<変更後のグループ>)` で保存し（`docs/specs/persistence.md`）、`publish({ type: "group.updated", data: { group: <変更後のグループ> } }, <変更前の members と変更後の members の和>)` を呼ぶ（`src/server/events.ts`）。
6. 変更後のグループを、`getGroupDetail` と同じ規則（`members` の順は参加順のまま、各IDを `UserRepository.findById` の `name` に置き換え、見つからなければ `UNKNOWN_MEMBER_NAME`）で `GroupDetail` にして返す。

`leaveGroupByUser`（`userId` は脱退する本人）は次の順に行う。

1. **ロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（`not_found` がそのまま伝わる）。
2. **ドメイン**: `leaveGroup(group, userId)`。オーナーなら `forbidden`（`オーナーは脱退できません。先にオーナーを委譲してください`）。
3. **保存**: `GroupRepository.save(<変更後のグループ>)` で保存する。
4. **発行**: `publish({ type: "group.updated", data: { group: <変更後のグループ> } }, <変更前の members と変更後の members の和>)` を呼ぶ（脱退した本人を含む。本人の別のタブ・ホームに反映するため）。

- どちらも、例外が投げられたら、それより後の手順を行わない（保存しない・発行しない）。
- イベントの `data.group` は `Group`（`{ id, name, ownerId, members }`。メンバーの名前を含まない）。名前を含む `GroupDetail` はAPIの応答にだけ含める（`docs/specs/realtime-events.md` のイベントの形を変えない）。
- 追加された人のホーム（`GroupList`）は、`group.updated` を受け取って一覧を取り直すので、追加されたグループがすぐ現れる。脱退した本人のホームからは、同じ取り直しでグループが消える（`docs/specs/web-groups.md`）。

### メンバーのAPI

いずれも現在の利用者が必要（`requireCurrentUser`。いなければ 401）。Route Handler は `createGroupRepository(getDb())`・`createUserRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。`context.params` は Next.js（App Router）の動的なセグメントの値（`Promise`）。

#### `src/app/api/groups/[groupId]/members/route.ts`（新規）

```ts
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `POST /api/groups/[groupId]/members` | `{ "userId": string }` | 200 `{ "group": { "id": string, "name": string, "ownerId": string, "members": [{ "id": string, "name": string }] } }` | 400（本文の形式）、401、403（オーナーでない）、404（メンバーでない・グループが存在しない・追加する利用者が存在しない） |

- `addMemberByUser(groups, users, groupId, <現在の利用者のid>, userId)` を呼ぶ。
- すでにメンバーの利用者を送っても、エラーにせず 200 と現在のグループを返す（保存も発行もしない）。
- 追加する利用者が存在しないときは 404（`code: "not_found"`、`message: "利用者が見つかりません"`）。
- `userId` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）にし、保存も発行もしない。
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

#### `src/app/api/groups/[groupId]/members/me/route.ts`（新規）

```ts
export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `DELETE /api/groups/[groupId]/members/me` | なし | 204（本文なし） | 401、403（オーナー）、404（メンバーでない・存在しない） |

- `leaveGroupByUser(groups, groupId, <現在の利用者のid>)` を呼ぶ。脱退できるのは現在の利用者本人だけで、パスに利用者IDを取らない（`me` は固定の文字列）。
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

### 画面

UI の規約は `docs/specs/ui-foundation.md` に従う。グループ設定画面の主操作は、これまでどおりオーナーに見せる「保存」ボタンだけにする（「追加」は主操作にしない。「グループから脱退」は破壊的操作の見た目にする）。

#### グループ設定画面（`src/app/groups/[groupId]/settings/page.tsx`）

- `docs/specs/group-settings.md` の内容に加えて、`listUsers(createUserRepository(getDb()))`（`docs/specs/web-api-foundation.md`）で利用者の一覧（登録順）を読み、`{ id, name }` の配列を `GroupSettingsView` の `users` に渡す。

#### 設定画面の本体（`src/components/group-settings-view.tsx`）

```tsx
import type { GroupDetail } from "../server/groups";

export type GroupSettingsViewProps = {
  groupId: string;
  currentUserId: string;
  initialGroup: GroupDetail;
  users: { id: string; name: string }[]; // 追加
};
```

`docs/specs/group-settings.md` の内容に、次を足す。「オーナーである」は、表示中のグループの `ownerId` が `currentUserId` と同じこと（`docs/specs/group-settings.md` と同じ）。

- **セクション「メンバー」**: `MemberList`（`src/components/member-list.tsx`。`docs/specs/group-settings.md`。この仕様では変更しない）の下に、オーナーなら `AddMemberForm` を描画する。オーナーでなければ描画しない。
  - `candidates` には、`users` のうち、表示中のグループの `members` に `id` が含まれない利用者を、`users` の順（登録順）で渡す。
  - `onAdded` で受け取ったグループで、表示中のグループを置き換える（`MemberList` の末尾に追加したメンバーの行が出て、`candidates` からその利用者が消える）。
- **画面下部**（セクション「メンバー」の下）:
  - オーナーでなければ、`LeaveGroupButton`（`groupName` に表示中のグループの `name`）を描画する。
  - オーナーなら、`LeaveGroupButton` を描画せず、`オーナーは脱退できません。先にオーナーを委譲してください`（`text-muted-foreground`）を出す。
  - オーナーの委譲に成功して「オーナーである」でなくなったら、`AddMemberForm` が消え、`LeaveGroupButton` が出る（逆に、自分への委譲を受け取ったら、`AddMemberForm` が出て `LeaveGroupButton` が消える）。
- **リアルタイム**（`docs/specs/group-settings.md` の `group.updated` のハンドラを変える。`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）:
  - `data.group.id` がこの画面の `groupId` と同じで、`currentUserId` が `data.group.members` に含まれないとき（別のタブで脱退した場合など）は、グループを取り直さずに `router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する。トーストは出さない（脱退を操作した画面は `LeaveGroupButton` がトーストを出す）。
  - `data.group.id` が同じで、`currentUserId` が `data.group.members` に含まれるとき（メンバーの追加・ほかのメンバーの脱退を含む）は、`docs/specs/group-settings.md` のとおりグループを取り直す。
  - `data.group.id` が違えば何もしない（`docs/specs/group-settings.md` のまま）。

#### メンバーの追加フォーム（`src/components/add-member-form.tsx`）

```tsx
import type { GroupDetail } from "../server/groups";

export const ADD_MEMBER_SELECT_ID = "add-member-user";

export type AddMemberFormProps = {
  groupId: string;
  candidates: { id: string; name: string }[];
  onAdded: (group: GroupDetail) => void;
};

export function AddMemberForm(props: AddMemberFormProps): React.JSX.Element;
```

Client Component。オーナーにだけ描画する（`GroupSettingsView` が判断する）。

- 見出しは `h3`「メンバーを追加」。
- **候補がいないとき**（`candidates` が空）: 見出しの下に `追加できる利用者がいません`（`text-muted-foreground`）を出す。Select と「追加」ボタンは描画しない。
- **候補がいるとき**: `form` 要素に、次を置く。
  - ラベル「追加する利用者」の Select（shadcn/ui の `Select`。トリガーの `id` は `ADD_MEMBER_SELECT_ID`、未選択の表示は `利用者を選択`）。選択肢は `candidates` の順に、利用者の `name` を文言、`id` を値にする。
  - 「追加」ボタン（`variant="secondary"`。主操作にしない。`type="submit"`）。利用者を選んでいない間は `disabled` にする。
- **送信**: `apiFetch<{ group: GroupDetail }>("/api/groups/<groupId>/members", { method: "POST", body: { userId: <選んだ利用者の id> } })` を呼ぶ。確認ダイアログは出さない（`docs/specs/ui-foundation.md`）。
  - 送信中は「追加」を `disabled` にし、文言を「追加中…」にする。
  - 成功したら `toast.success("<名前>さんを追加しました")`（`<名前>` は選んだ利用者の `name`）を出し、`onAdded(<応答の group>)` を呼び、選択を未選択に戻す。
  - 失敗したら、`toast.error(message)` を出す（選択肢から選ぶだけで入力値の誤りは起きないため、入力欄の直下には出さない）。選択は残し、「追加」の文言を戻す。
- **候補の変化**: `candidates` から選択中の利用者が消えたら（ほかのタブで追加された場合など）、選択を未選択に戻す。

#### 脱退ボタン（`src/components/leave-group-button.tsx`）

```tsx
export type LeaveGroupButtonProps = {
  groupId: string;
  groupName: string;
};

export function LeaveGroupButton(props: LeaveGroupButtonProps): React.JSX.Element;
```

Client Component。オーナーでない利用者にだけ描画する（`GroupSettingsView` が判断する）。

- 「グループから脱退」ボタン（`variant="destructive"`。破壊的操作の見た目。主操作ではない）を置く。押すと確認ダイアログ（`ConfirmDialog`。`docs/specs/ui-foundation.md`）を開く。
- **確認ダイアログ**（グループからの脱退は取り消せない操作のため確認する。`docs/specs/ui-foundation.md`）:
  - `title`: `「<groupName>」から脱退しますか？`
  - `description`: `脱退すると、このグループのメッセージを読んだり送ったりできなくなります。もう一度参加するには、オーナーに追加してもらう必要があります。`
  - `confirmLabel`: `脱退する`、`pendingLabel`: `脱退中…`、`destructive`: `true`
  - 確定ボタンを押すと、`apiFetch<null>("/api/groups/<groupId>/members/me", { method: "DELETE" })` を呼ぶ。送信中は `pending` を `true` にする。
  - 成功したら、`toast.success("「<groupName>」から脱退しました")` を出し、ダイアログを閉じ（`open` を `false`）、`router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する（脱退した後の設定画面・チャット画面は 404 になるため、履歴に残さない）。
  - 失敗したら、`toast.error(message)` を出し、ダイアログを開いたままにする（`pending` は `false` に戻す）。
  - 「キャンセル」を押すと、APIを呼ばずにダイアログを閉じる。

### チャット画面の変更（`src/components/chat-view.tsx`）

- `docs/specs/group-settings.md` で足した `group.updated` のハンドラに、次を足す（`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）。
  - `data.group.id` がこの画面の `groupId` と同じで、`currentUserId` が `data.group.members` に含まれなければ（別のタブで脱退した場合など）、`router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する。トーストは出さない。
  - 含まれていれば、`docs/specs/group-settings.md` のとおり（ヘッダーのグループ名を更新する）。
- メンバーが加わったことによる変更はしない。後から加わったメンバーの `message.created` は、名前が見つからないので一覧を取り直す（`docs/specs/web-chat.md` のまま）。

### 追加・変更するファイル

| パス | 内容 | 実装の区分 |
| --- | --- | --- |
| `src/group.ts` | `addMember` に `requesterId` を足してオーナー限定にする | メンバーの追加 |
| `src/group.ts` | `leaveGroup` を追加 | 自己脱退 |
| `src/group.test.ts` | 既存の `addMember` の呼び出しを新しい引数に直す | メンバーの追加 |
| `docs/specs/data-model.md` | `addMember` のシグネチャと「エラーの種別」の表を合わせる | メンバーの追加 |
| `src/server/groups.ts` | `addMemberByUser` を追加 | メンバーの追加 |
| `src/server/groups.ts` | `leaveGroupByUser` を追加 | 自己脱退 |
| `src/app/api/groups/[groupId]/members/route.ts` | `POST /api/groups/[groupId]/members`（新規） | メンバーの追加 |
| `src/app/api/groups/[groupId]/members/me/route.ts` | `DELETE /api/groups/[groupId]/members/me`（新規） | 自己脱退 |
| `src/app/groups/[groupId]/settings/page.tsx` | 利用者の一覧を `GroupSettingsView` の `users` に渡す | メンバーの追加 |
| `src/components/group-settings-view.tsx` | `AddMemberForm` の組み込みと `users` | メンバーの追加 |
| `src/components/group-settings-view.tsx` | 画面下部の `LeaveGroupButton`／オーナー向けの文言、自分がメンバーでなくなった `group.updated` でホームへ移動 | 自己脱退 |
| `src/components/add-member-form.tsx` | メンバーの追加フォーム（新規） | メンバーの追加 |
| `src/components/leave-group-button.tsx` | 脱退ボタンと確認ダイアログ（新規） | 自己脱退 |
| `src/components/chat-view.tsx` | 自分がメンバーでなくなった `group.updated` でホームへ移動 | 自己脱退 |

- `src/components/member-list.tsx` は変更しない（表示中のグループを置き換えると、追加・脱退したメンバーの行が反映される）。
- 実装は `docs/specs/group-settings.md` の実装（設定画面・`MemberList`・`ChatView` の `group.updated`）の後に行う。

### テスト

- ドメインのテストは `src/group.test.ts` に書く（Node の環境）。
- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。発行のテストは、`src/server/events.ts` の `subscribe` で購読し、最後に解除関数を呼ぶ（`docs/specs/realtime-events.md` の「テスト」）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。メンバーを増やすときは、`addMember(group, <オーナーのid>, <利用者のid>)` を適用したグループを `GroupRepository.save` で保存する。ハンドラには `{ params: Promise.resolve({ groupId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`apiFetch`（または `fetch`）、sonner の `toast`、`next/navigation` の `useRouter`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。
- shadcn/ui の `Select`（Radix UI）を jsdom で操作するテストでは、jsdom にない `Element.prototype.hasPointerCapture`・`Element.prototype.scrollIntoView` などを、テストの準備で空の関数に差し替える。
- `src/app/groups/[groupId]/settings/page.tsx` のテストは `docs/specs/group-settings.md` と同じ方法で行う。

## 受け入れ条件

### メンバーの追加

ドメイン（`src/group.ts` の `addMember`）

- [ ] オーナーが `addMember(group, <オーナーのid>, "u2")` を呼ぶと、`members` の末尾に `u2` を足した新しい `Group` が返り、元の `group` の `members` は変わらない
- [ ] `addMember` が返す `Group` の `id`・`name`・`ownerId` が元の `group` と同じである
- [ ] メンバーであってオーナーでない利用者が `addMember` を呼ぶと、`code` が `"forbidden"`、文言が `メンバーの追加はオーナーのみ可能です` の `DomainError` が投げられる
- [ ] メンバーでない利用者が `addMember` を呼ぶと、`code` が `"forbidden"` の `DomainError` が投げられる
- [ ] オーナーがすでにメンバーの利用者を `addMember` で追加すると、元の `group` と同じオブジェクトが返る
- [ ] オーナーでない利用者がすでにメンバーの利用者を `addMember` で追加すると、`code` が `"forbidden"` の `DomainError` が投げられる

ユースケース（`src/server/groups.ts` の `addMemberByUser`）

- [ ] オーナーが `addMemberByUser(…, groupId, <オーナーのid>, <利用者のid>)` を呼ぶと、`members` の末尾にその利用者の `{ id, name }` がある `GroupDetail` が返る
- [ ] `addMemberByUser` の後、`findById` で取り出したグループの `members` の末尾に追加した利用者がいる
- [ ] `addMemberByUser` で追加すると、`subscribe` した変更後のメンバー全員（操作したオーナーと追加された利用者を含む）のリスナーが、`type` が `group.updated`、`data.group.members` に追加した利用者を含むイベントで1回ずつ呼ばれる
- [ ] `addMemberByUser` で追加しても、`subscribe` したメンバーでない（追加もされていない）利用者のリスナーは呼ばれない
- [ ] メンバーであってオーナーでない利用者が `addMemberByUser` を呼ぶと、`code` が `"forbidden"`、文言が `メンバーの追加はオーナーのみ可能です` の `DomainError` が投げられ、`members` が変わらず、イベントが発行されない
- [ ] メンバーでない利用者が `addMemberByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ、イベントが発行されない
- [ ] `addMemberByUser` に存在しない利用者のIDを渡すと、`code` が `"not_found"`、文言が `利用者が見つかりません` の `DomainError` が投げられ、`members` が変わらず、イベントが発行されない
- [ ] `addMemberByUser` ですでにメンバーの利用者を追加すると、例外にならずに現在の `GroupDetail` が返り、`members` の数が変わらず、イベントが発行されない

`POST /api/groups/[groupId]/members`

- [ ] オーナーで `POST /api/groups/[groupId]/members` に `{ userId: <利用者のid> }` を送ると、200 と `{ group: { id, name, ownerId, members: [{ id, name }] } }` が返り、`members` の末尾にその利用者がいる
- [ ] `POST` で追加した後、追加された利用者の Cookie で `GET /api/groups` を呼ぶと、そのグループが含まれる
- [ ] `POST` に成功すると、`subscribe` した追加された利用者のリスナーが、`data.group.id` がそのグループの `id` の `group.updated` のイベントで呼ばれる
- [ ] メンバーであってオーナーでない利用者で `POST` を呼ぶと、403（`code: "forbidden"`、`message: "メンバーの追加はオーナーのみ可能です"`）が返り、`members` が変わらない
- [ ] メンバーでない利用者で `POST` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [ ] 存在しないID（UUID の形）で `POST` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [ ] `POST` の `userId` に存在しない利用者のID（UUID の形）を送ると、404（`code: "not_found"`、`message: "利用者が見つかりません"`）が返り、`members` が変わらない
- [ ] `POST` の `userId` にすでにメンバーの利用者を送ると、200 と現在のグループが返り、`members` の数が変わらない
- [ ] `POST` に `userId` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返り、イベントが発行されない
- [ ] Cookie のない `Request` で `POST` を呼ぶと、401（`code: "unauthenticated"`）が返る

グループ設定画面（`src/app/groups/[groupId]/settings/page.tsx`）

- [ ] オーナーで設定画面を描画して「追加する利用者」の Select を開くと、グループにいない登録済みの利用者の名前が選択肢にあり、メンバーの名前は選択肢にない

メンバーの追加フォーム（`src/components/add-member-form.tsx`）

- [ ] `AddMemberForm` に `h3`「メンバーを追加」がある
- [ ] `AddMemberForm` に候補を2人渡すと、ラベル「追加する利用者」の Select（`id` が `ADD_MEMBER_SELECT_ID`）があり、開くと候補の名前が渡した順に選択肢として出る
- [ ] 利用者を選んでいない間、「追加」ボタンが無効である
- [ ] 利用者を選ぶと、「追加」ボタンが有効になる
- [ ] 「追加」ボタンのクラスに `bg-primary` が含まれない
- [ ] `AddMemberForm` に空の `candidates` を渡すと、`追加できる利用者がいません` が出て、Select と「追加」ボタンがない
- [ ] 利用者を選んで「追加」を押すと、`POST /api/groups/<groupId>/members` に `{ userId: <選んだ利用者のid> }` が送られ、確認ダイアログ（`alertdialog`）が出ない
- [ ] 送信中は「追加」ボタンが無効で、文言が「追加中…」になる
- [ ] 追加に成功すると、`toast.success("<名前>さんを追加しました")` が呼ばれ、`onAdded` が応答の `group` で1回呼ばれ、選択が未選択（`利用者を選択`）に戻る
- [ ] 追加が失敗すると、`toast.error` がその `message` で呼ばれ、`onAdded` が呼ばれず、「追加」の文言が戻り、選択が残る
- [ ] 選択中の利用者を含まない `candidates` で再描画すると、選択が未選択に戻り、「追加」ボタンが無効になる

設定画面への組み込み（`src/components/group-settings-view.tsx`）

- [ ] オーナーで `GroupSettingsView` を描画すると、セクション「メンバー」に `h3`「メンバーを追加」があり、選択肢が `users` のうちメンバーでない利用者だけ（登録順）である
- [ ] オーナーでない利用者で `GroupSettingsView` を描画すると、`h3`「メンバーを追加」とラベル「追加する利用者」の Select がない
- [ ] `users` の全員がメンバーのとき、オーナーで描画した `GroupSettingsView` に `追加できる利用者がいません` が出る
- [ ] オーナーで描画した `GroupSettingsView` で追加に成功すると、メンバー一覧の末尾に追加した利用者の行が出て、その利用者が選択肢から消える
- [ ] オーナーで描画した `GroupSettingsView` のボタンのうち、クラスに `bg-primary` を含むもの（主操作）が「保存」だけである（`AddMemberForm` を描画した状態で確かめる）
- [ ] オーナーで描画した `GroupSettingsView` で委譲に成功すると、`h3`「メンバーを追加」がなくなる
- [ ] オーナーでない利用者で描画した `GroupSettingsView` で、自分への委譲の `group.updated` を受け取って取り直すと、`h3`「メンバーを追加」が出る
- [ ] この画面の `groupId` で、`currentUserId` を `members` に含む `group.updated` のハンドラを呼ぶと、`GET /api/groups/<groupId>` が呼ばれ、応答で加わったメンバーの行が出る
- [ ] `src/components/add-member-form.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

### 自己脱退

ドメイン（`src/group.ts` の `leaveGroup`）

- [ ] メンバー `u2` が `leaveGroup(group, "u2")` を呼ぶと、`members` から `u2` を除いた新しい `Group` が返り、元の `group` の `members` は変わらない
- [ ] `leaveGroup` が返す `Group` の `id`・`name`・`ownerId` と、残るメンバーの順序が元の `group` と同じである
- [ ] メンバーでない利用者が `leaveGroup` を呼ぶと、`code` が `"not_found"`、文言が `グループのメンバーではありません` の `DomainError` が投げられる
- [ ] オーナーが `leaveGroup` を呼ぶと、`code` が `"forbidden"`、文言が `オーナーは脱退できません。先にオーナーを委譲してください` の `DomainError` が投げられる

ユースケース（`src/server/groups.ts` の `leaveGroupByUser`）

- [ ] メンバーが `leaveGroupByUser(groups, groupId, <メンバーのid>)` を呼ぶと、`findById` で取り出したグループの `members` からその利用者が消え、ほかのメンバーの順序が変わらない
- [ ] `leaveGroupByUser` で脱退すると、`subscribe` した変更前のメンバー全員（脱退した本人とオーナーを含む）のリスナーが、`type` が `group.updated`、`data.group.members` に脱退した本人を含まないイベントで1回ずつ呼ばれる
- [ ] `leaveGroupByUser` で脱退しても、`subscribe` したメンバーでない利用者のリスナーは呼ばれない
- [ ] オーナーが `leaveGroupByUser` を呼ぶと、`code` が `"forbidden"`、文言が `オーナーは脱退できません。先にオーナーを委譲してください` の `DomainError` が投げられ、`members` が変わらず、イベントが発行されない
- [ ] メンバーでない利用者が `leaveGroupByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ、イベントが発行されない

`DELETE /api/groups/[groupId]/members/me`

- [ ] メンバーで `DELETE /api/groups/[groupId]/members/me` を呼ぶと、204 と空の本文が返り、その後の同じ利用者の `GET /api/groups/[groupId]` が 404 になる
- [ ] `DELETE` で脱退した後、同じ利用者の `GET /api/groups` にそのグループが含まれない
- [ ] `DELETE` に成功すると、`subscribe` したオーナーのリスナーが、`data.group.id` がそのグループの `id` の `group.updated` のイベントで呼ばれる
- [ ] オーナーで `DELETE` を呼ぶと、403（`code: "forbidden"`、`message: "オーナーは脱退できません。先にオーナーを委譲してください"`）が返り、`members` が変わらない
- [ ] メンバーでない利用者で `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [ ] 存在しないID（UUID の形）で `DELETE` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [ ] Cookie のない `Request` で `DELETE` を呼ぶと、401（`code: "unauthenticated"`）が返る

脱退ボタン（`src/components/leave-group-button.tsx`）

- [ ] `LeaveGroupButton` に「グループから脱退」ボタンがあり、そのクラスに `bg-destructive` が含まれ、`bg-primary` が含まれない
- [ ] 「グループから脱退」を押すと、`alertdialog` に `「<groupName>」から脱退しますか？` と `脱退すると、このグループのメッセージを読んだり送ったりできなくなります。もう一度参加するには、オーナーに追加してもらう必要があります。` が出る
- [ ] 確認ダイアログの「脱退する」ボタンのクラスに `bg-destructive` が含まれる
- [ ] 確認ダイアログの「キャンセル」を押すと、`DELETE` が呼ばれずにダイアログが閉じる
- [ ] 確認ダイアログの「脱退する」を押すと、`DELETE /api/groups/<groupId>/members/me` が呼ばれる
- [ ] 送信中は、確認ダイアログの確定ボタンが無効で、文言が「脱退中…」になる
- [ ] 脱退に成功すると、`toast.success("「<groupName>」から脱退しました")` が呼ばれ、`router.replace("/")` が呼ばれる
- [ ] 脱退が失敗すると、`toast.error` がその `message` で呼ばれ、ダイアログが開いたままで、`router.replace` が呼ばれない

設定画面への組み込み（`src/components/group-settings-view.tsx`）

- [ ] オーナーでない利用者で `GroupSettingsView` を描画すると、「グループから脱退」ボタンがあり、`オーナーは脱退できません。先にオーナーを委譲してください` が出ない
- [ ] オーナーで `GroupSettingsView` を描画すると、「グループから脱退」ボタンがなく、`オーナーは脱退できません。先にオーナーを委譲してください` が出る
- [ ] オーナーで描画した `GroupSettingsView` で委譲に成功すると、「グループから脱退」ボタンが出て、`オーナーは脱退できません。先にオーナーを委譲してください` が消える
- [ ] オーナーでない利用者で描画した `GroupSettingsView` の確認ダイアログのタイトルに、表示中のグループ名が入る
- [ ] オーナーでない利用者で描画した `GroupSettingsView` に、クラスに `bg-primary` を含むボタンがない
- [ ] この画面の `groupId` で、`currentUserId` を `members` に含まない `group.updated` のハンドラを呼ぶと、`router.replace("/")` が呼ばれ、`GET /api/groups/<groupId>` が呼ばれない
- [ ] この画面の `groupId` で、ほかのメンバーが抜けた（`currentUserId` を含む）`group.updated` のハンドラを呼ぶと、`GET /api/groups/<groupId>` が呼ばれ、応答で抜けたメンバーの行が消え、`router.replace` が呼ばれない
- [ ] 別の `groupId` で `currentUserId` を `members` に含まない `group.updated` のハンドラを呼んでも、`router.replace` が呼ばれない
- [ ] `GroupSettingsView` で `useLiveEvents` が1回だけ使われる
- [ ] `src/components/leave-group-button.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

チャット画面（`src/components/chat-view.tsx`）

- [ ] `ChatView` で、この画面の `groupId` の、`currentUserId` を `members` に含まない `group.updated` のハンドラを呼ぶと、`router.replace("/")` が呼ばれる
- [ ] `ChatView` で、この画面の `groupId` の、`currentUserId` を `members` に含む `group.updated` のハンドラを呼んでも、`router.replace` が呼ばれず、ヘッダーの `h1` の文言が `data.group.name` になる
- [ ] `ChatView` で、別の `groupId` の、`currentUserId` を `members` に含まない `group.updated` のハンドラを呼んでも、`router.replace` が呼ばれない

## 対象外

- オーナーによる除名（オーナーがほかのメンバーをグループから外すこと）。脱退できるのは本人だけ。`removeMember` を使う画面・APIも作らない
- 招待リンク、招待の承認（追加された利用者が承諾・拒否すること）。追加は、オーナーが選べばすぐに反映する
- 脱退後の再参加の制限（脱退した利用者も、オーナーがもう一度追加できる）。脱退した利用者の過去のメッセージは消さない（`docs/specs/web-chat.md`）
- オーナーの脱退（先に `transferOwner` で委譲する）。オーナーだけが残ったグループの自動の削除・自動の委譲
- 複数人をまとめて追加すること、利用者名での検索・絞り込み
- 設定画面を開いた後に登録された利用者を、追加の候補に反映すること（画面を開いたときの利用者の一覧を使う。新しい利用者は画面を開き直すと候補に出る）
- メンバーの上限人数
- 追加・脱退の通知（ブラウザの通知・チャットへのシステムメッセージなど）と、変更履歴の記録・表示
- 切断中に脱退した場合の `onReconnect` での扱い（取り直しが 404 で失敗し、`docs/specs/group-settings.md`・`docs/specs/web-chat.md` のとおり `toast.error` を出す。ホームへの自動の移動はしない）
- グループの削除と `group.deleted` の受信（`docs/specs/group-delete.md` で扱う）
- ブラウザを使うE2Eテスト

## 関連

- Issue #143（この仕様書の下書き）、親Issue #133、前提の仕様書 #137（`ui-foundation.md`）・#138（`web-api-foundation.md`）・#139（`realtime-events.md`）
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/data-model.md`（`Group`・`addMember`・`removeMember`・`DomainError` の `code`。「対象外」の `addMember` の権限チェックをこの仕様で扱う。`addMember` のシグネチャは実装のPRで直す）
- `docs/specs/persistence.md`（`GroupRepository.save` の `group_members` の差分の反映（残るメンバーの `joined_at` を保つ）・`findById`、`UserRepository.findById`・`list`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`・`requireCurrentUserInPage`、存在の秘匿、`listUsers`、`利用者が見つかりません` の文言、`apiFetch`（204 は `data: null`）、Route Handler のテストの方法）
- `docs/specs/ui-foundation.md`（設定画面の「脱退／削除」、主操作は1つ、確認ダイアログはグループからの脱退を含む4つだけ・メンバーの追加は確認なし、`ConfirmDialog`、フィードバック、`Select`、画面のテスト）
- `docs/specs/realtime-events.md`（`group.updated` の内容と届け先（メンバーの追加・脱退、変更前と変更後のメンバーの和）、自分が `members` に含まれないときの扱い、`publish`・`subscribe`、`useLiveEvents`、1タブ1接続）
- `docs/specs/web-groups.md`（`findGroupAsMember`・`getGroupDetail`・`GroupDetail`・`UNKNOWN_MEMBER_NAME`、`GroupList` の `group.updated` での取り直し）
- `docs/specs/group-settings.md`（`GroupSettingsPage`・`GroupSettingsView`・`MemberList`、`group.updated` での取り直し、`ChatView` の `group.updated` のハンドラ）
- `docs/specs/web-chat.md`（`ChatView`、後から加わったメンバーの `message.created` での取り直し、脱退したメンバーの過去のメッセージの名前）
- `src/group.ts`、`src/server/groups.ts`、`src/app/api/groups/[groupId]/members/route.ts`、`src/app/api/groups/[groupId]/members/me/route.ts`
- `src/app/groups/[groupId]/settings/page.tsx`、`src/components/group-settings-view.tsx`、`src/components/member-list.tsx`、`src/components/add-member-form.tsx`、`src/components/leave-group-button.tsx`、`src/components/chat-view.tsx`
