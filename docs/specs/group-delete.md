---
status: approved        # draft / approved / implemented / deprecated
updated: 2026-09-29
---

# グループの削除（オーナー限定）

## 目的

オーナーが、自分のグループを削除できるようにする（親Issue #133）。
削除は物理削除で、そのグループのメンバー・メッセージも一緒に消える（`docs/specs/persistence.md` の `ON DELETE CASCADE`）。ドメイン・ユースケース・API・グループ設定画面（`/groups/[groupId]/settings`）の各層で削除を扱えるようにし、削除を `group.deleted` で関係する画面（設定画面・チャット画面・ホーム）へすぐ反映する。

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行う。削除がオーナーだけに許されることは、ドメイン（`src/group.ts` の `assertCanDeleteGroup`）が検証する。メンバーかどうかは `findGroupAsMember`（`docs/specs/web-groups.md`）が検証する。
- **削除の方式は物理削除**にする。`GroupRepository.delete`（`docs/specs/persistence.md`）でグループの行を消す。そのグループの `group_members`・`messages` の行は `ON DELETE CASCADE` で一緒に消える。論理削除（削除フラグ）やゴミ箱は行わない（「対象外」）。
- APIの共通規約（エラー応答の形、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser` と 401、本文のない成功は 204）は `docs/specs/web-api-foundation.md` に従う。
- 自分がメンバーでないグループは、存在しないグループと同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）にする（`docs/specs/web-api-foundation.md` の「存在の秘匿」）。メンバーであってオーナーでない利用者の削除は、ドメインの `DomainError`（`forbidden`）のとおり 403 にする。
- UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、確認ダイアログは取り消せない操作だけ、フィードバックの出し方、ポーリングしない）は `docs/specs/ui-foundation.md` に従う。グループの削除は、確認ダイアログを出す4つの操作の1つ（`docs/specs/ui-foundation.md`）。
- イベントの種類・内容・届け先は `docs/specs/realtime-events.md` に従う。削除に成功したら、`group.deleted`（`{ groupId }`）を「削除した時点のグループのメンバー」（削除した本人を含む）に発行する。イベントの型・イベントバス・配信のエンドポイント・`useLiveEvents` はすでに `group.deleted` を含んでいるため、`src/server/events.ts`・`src/app/api/events/route.ts`・`src/components/use-live-events.ts` は変更しない。

### ドメイン（`src/group.ts`）

```ts
export function assertCanDeleteGroup(group: Group, requesterId: string): void;
```

- `requesterId` が `group.ownerId` と異なれば、`DomainError`（`code: "forbidden"`、文言 `グループの削除はオーナーのみ可能です`）を投げる。
- `requesterId` が `group.ownerId` と同じなら、何も返さず（戻り値は `undefined`）、例外も投げない。
- 純粋関数で、`Group` を変更しない（削除自体はリポジトリが行う。`docs/specs/persistence.md` の `GroupRepository.delete`）。

| 関数 | 条件 | 文言 | `code` |
| --- | --- | --- | --- |
| `assertCanDeleteGroup` | `requesterId` が `group.ownerId` と異なる | `グループの削除はオーナーのみ可能です` | `forbidden` |

### ユースケース（`src/server/groups.ts` に追加）

```ts
export async function deleteGroupByUser(
  groups: GroupRepository,
  groupId: string,
  userId: string,
): Promise<void>;
```

次の順に行う。

1. **ロード**: `findGroupAsMember(groups, groupId, userId)` でグループを取る（グループがない・メンバーでないときは、どちらも `DomainError`（`code: "not_found"`、文言 `グループが見つかりません`）がそのまま伝わる）。
2. **ドメイン**: `assertCanDeleteGroup(group, userId)`。オーナーでなければ `forbidden`（`グループの削除はオーナーのみ可能です`）。
3. **削除**: `GroupRepository.delete(groupId)` で削除する（メンバー・メッセージの行は `ON DELETE CASCADE` で一緒に消える）。
4. **発行**: `publish({ type: "group.deleted", data: { groupId } }, group.members)` を呼ぶ（`src/server/events.ts`）。届け先は、1でロードした削除前の `group.members`（削除した時点のメンバー全員。削除した本人を含む）。
5. 戻り値はない（`void`）。

- 1〜3のどこかで例外が投げられたら、それより後の手順を行わない（削除しない・発行しない）。

### グループの削除API（`src/app/api/groups/[groupId]/route.ts`、`DELETE` を追加）

```ts
export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response>;
```

現在の利用者が必要（`requireCurrentUser`。いなければ 401）。Route Handler は `createGroupRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。`context.params` は Next.js（App Router）の動的なセグメントの値（`Promise`）。

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `DELETE /api/groups/[groupId]` | なし | 204（本文なし） | 401、403（オーナーでない）、404（メンバーでない・存在しない） |

- `deleteGroupByUser(groups, groupId, <現在の利用者のid>)` を呼ぶ。
- `GET`・`PATCH /api/groups/[groupId]`（`docs/specs/web-groups.md`・`docs/specs/group-settings.md`）はそのまま残す。上の表と、これらにないメソッドは Next.js の既定の 405 に任せる。

### 画面

UI の規約は `docs/specs/ui-foundation.md` に従う。グループ設定画面の主操作は、これまでどおりオーナーに見せる「保存」ボタンだけにする（「グループを削除」は破壊的操作の見た目にし、主操作にしない）。

#### 設定画面の本体（`src/components/group-settings-view.tsx`）

`docs/specs/group-settings.md`・`docs/specs/group-members.md` の内容に、次を足す。「オーナーである」は、表示中のグループの `ownerId` が `currentUserId` と同じこと（これまでの仕様と同じ）。

- **画面下部**（`docs/specs/group-members.md` で足した `LeaveGroupButton`／オーナー向けの文言の下）:
  - オーナーなら、その下に `DeleteGroupButton`（`groupId`・`groupName` に表示中のグループの `id`・`name`）を描画する。
  - オーナーでなければ、`DeleteGroupButton` を描画しない。
  - オーナーの委譲に成功して「オーナーである」でなくなったら、`DeleteGroupButton` が消える（逆に、自分への委譲を受け取ったら `DeleteGroupButton` が出る）。
- **リアルタイム**（`docs/specs/group-settings.md`・`docs/specs/group-members.md` の `group.updated` のハンドラに、`group.deleted` のハンドラを足す。`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）:
  - `data.groupId` がこの画面の `groupId` と同じなら、`toast.error("このグループは削除されました")` を出し、`router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する。グループを取り直さない。
  - 違えば何もしない（ストリームには、自分がメンバーのほかのグループのイベントも届く）。

#### 削除ボタン（`src/components/delete-group-button.tsx`）

```tsx
export type DeleteGroupButtonProps = {
  groupId: string;
  groupName: string;
};

export function DeleteGroupButton(props: DeleteGroupButtonProps): React.JSX.Element;
```

Client Component。オーナーにだけ描画する（`GroupSettingsView` が判断する）。

- 「グループを削除」ボタン（`variant="destructive"`。破壊的操作の見た目。主操作ではない）を置く。押すと確認ダイアログ（`ConfirmDialog`。`docs/specs/ui-foundation.md`）を開く。
- **確認ダイアログ**（グループの削除は取り消せない操作のため確認する。`docs/specs/ui-foundation.md`）:
  - `title`: `「<groupName>」を削除しますか？`
  - `description`: `メッセージもすべて削除され、元に戻せません。`
  - `confirmLabel`: `削除する`、`pendingLabel`: `削除中…`、`destructive`: `true`
  - 確定ボタンを押すと、`apiFetch<null>("/api/groups/<groupId>", { method: "DELETE" })` を呼ぶ。送信中は `pending` を `true` にする。
  - 成功したら、`toast.success("グループを削除しました")` を出し、ダイアログを閉じ（`open` を `false`）、`router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する（削除した後の設定画面・チャット画面は 404 になるため、履歴に残さない）。
  - 失敗したら、`toast.error(message)` を出し、ダイアログを開いたままにする（`pending` は `false` に戻す）。
  - 「キャンセル」を押すと、APIを呼ばずにダイアログを閉じる。

### チャット画面の変更（`src/components/chat-view.tsx`）

- `docs/specs/group-settings.md`・`docs/specs/group-members.md` で足した `group.updated` のハンドラに、`group.deleted` のハンドラを足す（`useLiveEvents` を呼ぶのはこれまでどおりこの部品の1か所だけ）。
  - `data.groupId` がこの画面の `groupId` と同じなら、`toast.error("このグループは削除されました")` を出し、`router.replace("/")`（`next/navigation` の `useRouter`）でホームへ移動する。
  - 違えば何もしない。

### ホーム画面（`src/components/group-list.tsx`）

- `docs/specs/web-groups.md` の `GroupList` は、すでに `group.deleted` を受け取ると一覧を取り直す（`GET /api/groups`）。取り直しの応答に削除したグループが含まれなくなるので、一覧から消える。この仕様での変更はない。

### 追加・変更するファイル

| パス | 内容 |
| --- | --- |
| `src/group.ts` | `assertCanDeleteGroup` を追加 |
| `src/server/groups.ts` | `deleteGroupByUser` を追加 |
| `src/app/api/groups/[groupId]/route.ts` | `DELETE /api/groups/[groupId]` を追加 |
| `src/app/groups/[groupId]/settings/page.tsx` | 変更なし（`GroupSettingsView` に渡す props は変わらない） |
| `src/components/group-settings-view.tsx` | `DeleteGroupButton` の組み込み、`group.deleted` のハンドラ |
| `src/components/delete-group-button.tsx` | 削除ボタンと確認ダイアログ（新規） |
| `src/components/chat-view.tsx` | `group.deleted` のハンドラ |

- `src/app/groups/[groupId]/settings/page.tsx` は、`GroupSettingsView` の props（`groupId`・`currentUserId`・`initialGroup`・`users`）を変えないため、この仕様では変更しない。

### テスト

- ドメインのテストは `src/group.test.ts` に書く（Node の環境）。
- ユースケースのテストは、`createDb(":memory:")` のDBで作ったリポジトリを渡す（`docs/specs/persistence.md`）。発行のテストは、`src/server/events.ts` の `subscribe` で購読し、最後に解除関数を呼ぶ（`docs/specs/realtime-events.md` の「テスト」）。
- Route Handler のテストは `docs/specs/web-api-foundation.md` の「テスト」に従う（`Request` を作ってハンドラを直接呼ぶ。`getDb` を `vi.mock` で `createDb(":memory:")` のDBに差し替える）。利用者は `UserRepository.insert` で作り、その `id` を `type_chat_user_id` の Cookie に入れる。メンバーを増やすときは、`addMember(group, <オーナーのid>, <利用者のid>)` を適用したグループを `GroupRepository.save` で保存する。ハンドラには `{ params: Promise.resolve({ groupId }) }` を渡す。
- 画面のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`apiFetch`（または `fetch`）、sonner の `toast`、`next/navigation` の `useRouter`、`useLiveEvents` は `vi.mock` で差し替える（`useLiveEvents` の偽物は、渡された `handlers`・`onReconnect` をテストから呼べるようにする）。

## 受け入れ条件

### ドメイン（`src/group.ts` の `assertCanDeleteGroup`）

- [ ] オーナー（`requesterId` が `group.ownerId` と同じ）で `assertCanDeleteGroup` を呼んでも、例外が投げられない
- [ ] オーナーでない利用者で `assertCanDeleteGroup` を呼ぶと、`code` が `"forbidden"`、文言が `グループの削除はオーナーのみ可能です` の `DomainError` が投げられる

### ユースケース（`src/server/groups.ts` の `deleteGroupByUser`）

- [ ] オーナーが `deleteGroupByUser(groups, groupId, <オーナーのid>)` を呼ぶと、その後の `GroupRepository.findById(groupId)` が `null` を返す
- [ ] `deleteGroupByUser` で削除すると、`subscribe` した削除した時点のグループのメンバー全員（削除したオーナーを含む）のリスナーが、`type` が `group.deleted`、`data.groupId` がそのグループの `id` のイベントで1回ずつ呼ばれる
- [ ] `deleteGroupByUser` で削除しても、`subscribe` したメンバーでない利用者のリスナーは呼ばれない
- [ ] メンバーであってオーナーでない利用者が `deleteGroupByUser` を呼ぶと、`code` が `"forbidden"`、文言が `グループの削除はオーナーのみ可能です` の `DomainError` が投げられ、グループが残り、イベントが発行されない
- [ ] メンバーでない利用者が `deleteGroupByUser` を呼ぶと、`code` が `"not_found"`、文言が `グループが見つかりません` の `DomainError` が投げられ、イベントが発行されない
- [ ] オーナーが `deleteGroupByUser` を呼ぶと、その後の `MessageRepository.listByGroup(groupId)` が空配列を返す（`ON DELETE CASCADE`）

### `DELETE /api/groups/[groupId]`

- [ ] オーナーで `DELETE /api/groups/[groupId]` を呼ぶと、204 と空の本文が返り、その後の同じ利用者の `GET /api/groups/[groupId]` が 404 になる
- [ ] `DELETE` で削除した後、同じ利用者の `GET /api/groups` にそのグループが含まれない
- [ ] `DELETE` に成功すると、`subscribe` したほかのメンバーのリスナーが、`data.groupId` がそのグループの `id` の `group.deleted` のイベントで呼ばれる
- [ ] メンバーであってオーナーでない利用者で `DELETE` を呼ぶと、403（`code: "forbidden"`、`message: "グループの削除はオーナーのみ可能です"`）が返り、その後の `GET /api/groups/[groupId]` が200のままである
- [ ] メンバーでない利用者で `DELETE` を呼ぶと、404（`code: "not_found"`、`message: "グループが見つかりません"`）が返る
- [ ] 存在しないID（UUID の形）で `DELETE` を呼ぶと、メンバーでない利用者への応答と同じステータスと本文の 404 が返る
- [ ] Cookie のない `Request` で `DELETE` を呼ぶと、401（`code: "unauthenticated"`）が返る

### 削除ボタン（`src/components/delete-group-button.tsx`）

- [ ] `DeleteGroupButton` に「グループを削除」ボタンがあり、そのクラスに `bg-destructive` が含まれ、`bg-primary` が含まれない
- [ ] 「グループを削除」を押すと、`alertdialog` に `「<groupName>」を削除しますか？` と `メッセージもすべて削除され、元に戻せません。` が出る
- [ ] 確認ダイアログの「削除する」ボタンのクラスに `bg-destructive` が含まれる
- [ ] 確認ダイアログの「キャンセル」を押すと、`DELETE` が呼ばれずにダイアログが閉じる
- [ ] 確認ダイアログの「削除する」を押すと、`DELETE /api/groups/<groupId>` が呼ばれる
- [ ] 送信中は、確認ダイアログの確定ボタンが無効で、文言が「削除中…」になる
- [ ] 削除に成功すると、`toast.success("グループを削除しました")` が呼ばれ、`router.replace("/")` が呼ばれる
- [ ] 削除が失敗すると、`toast.error` がその `message` で呼ばれ、ダイアログが開いたままで、`router.replace` が呼ばれない

### 設定画面への組み込み（`src/components/group-settings-view.tsx`）

- [ ] オーナーで `GroupSettingsView` を描画すると、「グループを削除」ボタンがある
- [ ] オーナーでない利用者で `GroupSettingsView` を描画すると、「グループを削除」ボタンがない
- [ ] オーナーで描画した `GroupSettingsView` で委譲に成功すると、「グループを削除」ボタンが消える
- [ ] オーナーでない利用者で描画した `GroupSettingsView` で、自分への委譲の `group.updated` を受け取って取り直すと、「グループを削除」ボタンが出る
- [ ] オーナーで描画した `GroupSettingsView` のボタンのうち、クラスに `bg-primary` を含むもの（主操作）が「保存」だけである（`DeleteGroupButton` を描画した状態で確かめる）
- [ ] この画面の `groupId` の `group.deleted` のハンドラを呼ぶと、`toast.error("このグループは削除されました")` が呼ばれ、`router.replace("/")` が呼ばれる
- [ ] 別の `groupId` の `group.deleted` のハンドラを呼んでも、`toast.error` も `router.replace` も呼ばれない
- [ ] `GroupSettingsView` で `useLiveEvents` が1回だけ使われる
- [ ] `src/components/delete-group-button.tsx` の内容に、`setInterval` と `setTimeout` が含まれない（ファイルを読んで検査する）

### チャット画面（`src/components/chat-view.tsx`）

- [ ] `ChatView` で、この画面の `groupId` の `group.deleted` のハンドラを呼ぶと、`toast.error("このグループは削除されました")` が呼ばれ、`router.replace("/")` が呼ばれる
- [ ] `ChatView` で、別の `groupId` の `group.deleted` のハンドラを呼んでも、`toast.error` も `router.replace` も呼ばれない

## 対象外

- 削除の取り消し（元に戻す操作）、ゴミ箱（削除したグループを一定期間残して復元できるようにすること）
- アーカイブ（削除せずに一覧から隠す・読み取り専用にすること）
- メンバーの過半数の同意など、オーナー以外の関与が必要な削除の承認フロー
- 論理削除（削除フラグを立てて残すこと）と、チャット画面での「削除されました」の表示（削除した画面は即座にホームへ移動するため、チャットの中身は表示しない）
- グループの削除の通知（ブラウザの通知・メールなど）と、削除の履歴の記録・表示
- オーナー以外による削除（除名と同じく、この仕様では扱わない。削除できるのはオーナーだけ）
- 複数件をまとめて削除すること
- 切断中に削除された場合の `onReconnect` での扱い（取り直しが 404 で失敗し、`docs/specs/group-settings.md`・`docs/specs/web-chat.md` のとおり `toast.error` を出す。この仕様の `group.deleted` によるホームへの自動の移動はしない）
- ブラウザを使うE2Eテスト

## 関連

- Issue #145（この仕様書の下書き）、親Issue #133、前提の仕様書 #137（`ui-foundation.md`）・#138（`web-api-foundation.md`）・#139（`realtime-events.md`）
- `docs/decisions/0001-web-app-stack.md`（層構成、SSE、ポーリングを使わない判断）
- `docs/specs/data-model.md`（`Group`・`DomainError` の `code`）
- `docs/specs/persistence.md`（`GroupRepository.delete`・`findById`、`group_members`・`messages` の `ON DELETE CASCADE`、`createDb(":memory:")`・`getDb`）
- `docs/specs/web-api-foundation.md`（エラー応答、`handleApi`・`readJsonBody`・`jsonResponse`、`requireCurrentUser`、存在の秘匿、`apiFetch`（204 は `data: null`）、Route Handler のテストの方法）
- `docs/specs/ui-foundation.md`（設定画面の「脱退／削除」、主操作は1つ、確認ダイアログはグループの削除を含む4つだけ、`ConfirmDialog`、フィードバック、画面のテスト）
- `docs/specs/realtime-events.md`（`group.deleted` の内容と届け先、`publish`・`subscribe`、`useLiveEvents`、1タブ1接続）
- `docs/specs/web-groups.md`（`findGroupAsMember`、`GroupList` の `group.deleted` での取り直し）
- `docs/specs/group-settings.md`（`GroupSettingsView`、`group.updated` の取り直し、`ChatView` の `group.updated` のハンドラ）
- `docs/specs/group-members.md`（`LeaveGroupButton`・脱退の確認ダイアログの先例、画面下部の構成）
- `docs/specs/web-chat.md`（`ChatView`）
- `src/group.ts`、`src/server/groups.ts`、`src/app/api/groups/[groupId]/route.ts`
- `src/app/groups/[groupId]/settings/page.tsx`、`src/components/group-settings-view.tsx`、`src/components/delete-group-button.tsx`、`src/components/chat-view.tsx`
