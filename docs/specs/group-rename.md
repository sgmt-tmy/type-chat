---
status: implemented        # draft / approved / implemented / deprecated
updated: 2026-09-25
---

# グループ名の変更

## 目的

グループのオーナーが、作成済みのグループの名前を変更できるようにする。
現状 `src/group.ts` にはグループ名を変更する手段がなく、`createGroup` 時に決めた名前を後から変えられない。

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
```

- `createGroup` は `name` をトリムし、空文字なら例外を投げる。ただし最大文字数の制限は現状ない。
- `addMember` / `removeMember` はいずれも `Group` を受け取り、更新後の新しい `Group` を返す（イミュータブルな更新）。本仕様の `renameGroup` もこのパターンに合わせる。



### 追加を想定する関数（本仕様の対象）

```ts
const GROUP_NAME_MAX_LENGTH = 50;

function renameGroup(
  group: Group,
  requesterId: string,
  newName: string,
): Group;
```

- 入力
  - `group`: 変更対象の `Group`
  - `requesterId`: 変更を実行しようとするユーザーID
  - `newName`: 変更後のグループ名（前後の空白はトリムする）
- 処理
  - `requesterId !== group.ownerId` の場合はエラーを投げる（オーナー以外は変更不可）
  - `newName` をトリムし、空文字ならエラーを投げる（`createGroup` と同じ規則）
  - トリム後の `newName` が `GROUP_NAME_MAX_LENGTH`（50文字）を超える場合はエラーを投げる
  - 上記を満たせば、`name` のみ `newName`（トリム後）に更新した新しい `Group` を返す。`ownerId` と `members` は変更しない
- 出力
  - 成功時: `name` が更新された新しい `Group`（元の `group` は変更しない）
- エラー
  - オーナー以外からの変更: `Error`（例: `"グループ名の変更はオーナーのみ可能です"`）
  - 空文字（トリム後空文字を含む）: `Error`（例: `"グループ名は空にできません"`）
  - 最大文字数超過: `Error`（例: `"グループ名は50文字以内で入力してください"`）
  - 存在しないグループを指定した場合: `renameGroup` は `Group` オブジェクトを直接受け取る設計のため、「存在しないグループ」を表す状態はこの関数の対象外（呼び出し側でグループの検索・存在確認を行う場合、その結果は別途扱う。本仕様の範囲では「グループが見つからない」ケースのテストは対象外とする）



## 受け入れ条件

- [x] オーナー（`requesterId === group.ownerId`）が変更すると、`name` が更新された新しい `Group` が返る
- [x] オーナー以外のメンバーが変更しようとすると例外が投げられ、元の `group` は変更されない
- [x] グループに属さないユーザーが変更しようとすると例外が投げられる
- [x] 空文字（トリム後空文字を含む）を指定すると例外が投げられる
- [x] 前後に空白を含む名前を指定すると、トリムされた名前が設定される
- [x] `GROUP_NAME_MAX_LENGTH`（50文字）ちょうどの名前は変更できる
- [x] `GROUP_NAME_MAX_LENGTH`（50文字）を超える名前を指定すると例外が投げられる
- [x] 変更後、`ownerId` と `members` は変更前と同じ値のまま保たれる
- [x] 変更前の `group` オブジェクト自体は変更されない（`renameGroup` はイミュータブルに新しい `Group` を返す）



## 対象外

- 「存在しないグループ」をID等で検索して特定する処理（`Group` 型・関数群には現状グループを一意に識別するID/ストレージの概念がなく、本仕様の対象外。将来グループの永続化・検索機能を仕様化する際に扱う）
- グループ名の重複チェック（同名グループの許可・禁止は未定義のため対象外）
- グループ名の変更履歴・通知
- オーナー権限の委譲（オーナー変更機能）



## 関連

- `src/group.ts`（`Group`, `createGroup`, `addMember`, `removeMember`）
- `docs/specs/group-message.md`（`Group` 型を使う既存機能。同様にイミュータブルな更新パターンを踏襲）

