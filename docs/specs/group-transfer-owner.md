---
status: approved        # draft / approved / implemented / deprecated
updated: 2026-09-25
---

# オーナー権限の委譲

## 目的

グループのオーナーが、グループ内の別のメンバーにオーナー権限を委譲できるようにする。
現状 `src/group.ts` にはオーナーを変更する手段がなく、`createGroup` 時に決まった `ownerId` を後から変更できない。

## 入出力

### 既存の型・関数（`src/group.ts`）

```ts
type Group = {
  name: string;
  ownerId: string;
  members: string[];
};

function createGroup(name: string, ownerId: string): Group;
function addMember(group: Group, userId: string): Group;
function removeMember(group: Group, userId: string): Group;
function renameGroup(group: Group, requesterId: string, newName: string): Group;
```

- `removeMember` は `userId === group.ownerId` のとき例外を投げる（オーナーはメンバーから削除できない）。
- `renameGroup` は「`requesterId !== group.ownerId` なら例外」というオーナー限定の権限チェックパターンを持つ。本仕様の `transferOwner` もこのパターンに合わせる。
- `Group` にはオーナーを複数人にする概念（共同オーナー）はない。

### 追加を想定する関数（本仕様の対象）

```ts
function transferOwner(
  group: Group,
  requesterId: string,
  newOwnerId: string,
): Group;
```

- 入力
  - `group`: 対象の `Group`
  - `requesterId`: 委譲を実行しようとするユーザーID
  - `newOwnerId`: 委譲先のユーザーID
- 処理
  - `requesterId !== group.ownerId` の場合はエラーを投げる（オーナー以外は委譲を実行できない）
  - `newOwnerId === group.ownerId` の場合はエラーを投げる（現在のオーナー自身への委譲は不可）
  - `newOwnerId` が `group.members` に含まれない場合はエラーを投げる（グループのメンバーでない相手には委譲できない）
  - 上記を満たせば、`ownerId` のみ `newOwnerId` に更新した新しい `Group` を返す。`name` と `members` は変更しない（旧オーナーは委譲後も `members` に残したままにし、自動では外さない。`members` から外す必要があれば、呼び出し側が別途 `removeMember` を呼ぶ）
- 出力
  - 成功時: `ownerId` が更新された新しい `Group`（元の `group` は変更しない）
- エラー
  - オーナー以外からの実行: `Error`（例: `"オーナー権限の委譲はオーナーのみ可能です"`）
  - 委譲先が現在のオーナー自身: `Error`（例: `"委譲先が現在のオーナーと同じです"`）
  - 委譲先がメンバーでない: `Error`（例: `"委譲先はグループのメンバーである必要があります"`）
  - 存在しないグループを指定した場合: `transferOwner` は `Group` オブジェクトを直接受け取る設計のため、「存在しないグループ」を表す状態はこの関数の対象外（`renameGroup` と同様）

## 受け入れ条件

- [ ] オーナー（`requesterId === group.ownerId`）が、自分以外のメンバーへ委譲すると、`ownerId` が `newOwnerId` に更新された新しい `Group` が返る
- [ ] オーナー以外のメンバーが委譲を実行しようとすると例外が投げられ、元の `group` は変更されない
- [ ] グループに属さないユーザーが委譲を実行しようとすると例外が投げられる
- [ ] 委譲先（`newOwnerId`）が現在のオーナー自身（`group.ownerId`）と同じ場合は例外が投げられる
- [ ] 委譲先（`newOwnerId`）がグループのメンバーでない場合は例外が投げられる
- [ ] 委譲が成功した場合でも、旧オーナーは `members` に残ったままである（`members` からは自動的に外れない）
- [ ] 委譲後、`name` と `members` は変更前と同じ値のまま保たれる
- [ ] 変更前の `group` オブジェクト自体は変更されない（`transferOwner` はイミュータブルに新しい `Group` を返す）

## 対象外

- 委譲後に旧オーナーを `members` から自動的に外すこと（旧オーナーは常に `members` に残す。外す場合は呼び出し側が別途 `removeMember` を呼ぶ想定）
- 共同オーナー（複数人がオーナー権限を持つ）という概念の導入
- オーナー権限委譲の履歴・通知
- 存在しないグループ／存在しないユーザーをIDで検索して特定する処理（`Group` 型・関数群には現状グループやユーザーを一意に識別して検索するストレージの概念がなく対象外。`group-rename.md` と同様の理由）

## 関連

- `src/group.ts`（`Group`, `createGroup`, `addMember`, `removeMember`, `renameGroup`）
- `docs/specs/group-rename.md`（オーナー限定の権限チェックパターンの先例。「対象外」に「オーナー権限の委譲」を挙げていた）
