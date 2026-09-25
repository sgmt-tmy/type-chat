---
status: implemented        # draft / approved / implemented / deprecated
updated: 2026-09-24
---

# グループへのメッセージ投稿

## 目的

グループのメンバーが、そのグループにメッセージを投稿できるようにする。
現状 `src/message.ts` の `createMessage` は投稿者がグループのメンバーかどうかを検証しないため、
`src/group.ts` の `Group` 型と組み合わせて「メンバーのみ投稿できる」という制約を追加する。

## 入出力

### 既存の型・関数（`src/group.ts`）

```ts
type Group = {
  name: string;
  ownerId: string;
  members: string[];
};
```

- グループへの投稿可否は `group.members.includes(userId)` で判定する。

### 既存の型・関数（`src/message.ts`）

```ts
type Message = {
  groupId: string;
  text: string;
  sentAt: Date;
};

const MESSAGE_MAX_LENGTH = 1000;

function createMessage(
  groupId: string,
  text: string,
  sentAt?: Date,
): Message;
```

- `text` は前後の空白をトリムし、空文字なら例外、`MESSAGE_MAX_LENGTH`（1000文字）超過でも例外。
- `Message` 型には投稿者を表すフィールドが存在しない。



### 追加を想定する関数（本仕様の対象）

```ts
function postMessageToGroup(
  group: Group,
  senderId: string,
  text: string,
  sentAt?: Date,
): Message;
```

- 入力
  - `group`: 投稿先の `Group`
  - `senderId`: 投稿しようとするユーザーID
  - `text`: 投稿本文（`createMessage` にそのまま渡す）
  - `sentAt`: 省略可。省略時は `createMessage` 側のデフォルト（現在時刻）を使う
- 処理
  - `senderId` が `group.members` に含まれない場合はエラーを投げる（メンバー以外は投稿不可）
  - メンバーであれば `createMessage(group.name, text, sentAt)` を呼び出し、その結果（`Message`）を返す
    - `groupId` に何を渡すか（`group.name` か、別途グループIDを導入するか）は既存コードにグループID相当のフィールドが無いため要検討。本仕様では暫定的に `group.name` をグループ識別子として扱う
- 出力
  - 成功時: 作成された `Message`
- エラー
  - メンバー外からの投稿: `Error`（例: `"グループのメンバーではありません"`）
  - 本文が空 / 最大文字数超過: `createMessage` が投げる既存のエラーがそのまま伝播する



## 受け入れ条件

- [x] グループのメンバーが投稿すると、`groupId` が正しく設定された `Message` が返る
- [x] グループのオーナー（`ownerId`）が投稿できる（オーナーは常に `members` に含まれるため）
- [x] グループのメンバーでないユーザーが投稿しようとすると例外が投げられる
- [x] 空文字（トリム後空文字を含む）を投稿しようとすると例外が投げられる（`createMessage` の既存挙動を継承）
- [x] `MESSAGE_MAX_LENGTH`（1000文字）を超える本文を投稿しようとすると例外が投げられる（既存挙動を継承）
- [x] `sentAt` を指定した場合、その値が `Message.sentAt` に反映される
- [x] `sentAt` を省略した場合、現在時刻が `Message.sentAt` に設定される



## 対象外

- メッセージの編集・削除
- メッセージの永続化（DB保存など）や取得API
- 投稿者情報を `Message` 型に保持すること（別仕様で検討）
- グループの識別子（ID）を `Group` 型に追加すること（別仕様で検討。本仕様では `group.name` を暫定的に代用）
- 通知・既読管理



## 関連

- `src/group.ts`（`Group`, `createGroup`, `addMember`, `removeMember`）
- `src/message.ts`（`Message`, `createMessage`, `sortMessagesByTime`）

