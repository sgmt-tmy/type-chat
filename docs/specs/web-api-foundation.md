---
status: draft        # draft / approved / implemented / deprecated
updated: 2026-09-28
---

# APIの共通規約と、認証なしでの利用者の識別

## 目的

認証はスコープ外（ADR 0001）だが、オーナー限定の操作や投稿者本人だけの削除には「今の利用者は誰か」が要る。認証なしで利用者を識別する方法（Cookie に利用者IDを入れる）と、全APIに共通のエラー応答・日時の表現を決める。
あわせて、利用者の登録・切り替えのAPI、利用開始の画面（`/start`）、共通ヘッダーの利用者メニュー、画面から API を呼ぶクライアント（`src/lib/api-client.ts`）を定める。

利用者の識別の方式は Issue #138 のgate承認（2026-09-28、「すべて推奨通りで承認」）で決めた。

| 判断 | 決定 |
| --- | --- |
| 1. Cookie に入れる値 | 利用者IDをそのまま入れる（署名しない）。`HttpOnly`・`SameSite=Lax`・`Path=/`、有効期限1年 |
| 2. 既存の利用者に入り直せるか | 入り直せる。`/start` に既存の利用者の一覧を出し、選んで入り直す |
| 3. 利用者名の重複と最大長 | 前後の空白を除いた名前が既存の利用者と完全に一致したら 409（`conflict`、「その名前はすでに使われています」）。最大30文字 |

## 入出力

### 共通の方針

- 層構成は ADR 0001 に従う。Route Handler（`src/app/api/`）は HTTP（JSON）とユースケース（`src/server/`）の間の変換だけを行い、ドメインの規則はドメイン（`src/*.ts`）が検証する。
- API の入出力は JSON（`Content-Type: application/json`）。本文のない成功（204）を除き、応答の本文は必ず JSON にする。
- 成功の応答は、資源を名前つきのキーで包む（例: `{ "user": { ... } }`、`{ "users": [ ... ] }`）。以降のAPIの仕様もこの形に従う。

### エラー応答（`src/server/http.ts`）

エラーの応答の本文は、すべて次の形にする。

```json
{ "error": { "code": "not_found", "message": "グループが見つかりません" } }
```

| 原因 | ステータス | `code` | `message` |
| --- | --- | --- | --- |
| `DomainError`（`code: "validation"`） | 400 | `validation` | 例外の `message` |
| `DomainError`（`code: "forbidden"`） | 403 | `forbidden` | 例外の `message` |
| `DomainError`（`code: "not_found"`） | 404 | `not_found` | 例外の `message` |
| `DomainError`（`code: "conflict"`） | 409 | `conflict` | 例外の `message` |
| 利用者を識別できない（Cookie がない、Cookie の利用者が存在しない） | 401 | `unauthenticated` | `利用を開始してください` |
| リクエストの本文が JSON として読めない、または必要な項目の型が違う | 400 | `validation` | `リクエストの形式が正しくありません` |
| 上記以外の例外（想定外のエラー） | 500 | `internal` | `サーバーでエラーが発生しました` |

- 想定外のエラーの `message` は固定の文言にし、例外の `message`・スタックトレース・SQL などの内部の詳細を応答に含めない。例外の内容はサーバーのログ（`console.error`）にだけ出す。
- `DomainError` の `code` の定義は `docs/specs/data-model.md` に従う。

```ts
export type ApiErrorCode = DomainErrorCode | "unauthenticated" | "internal";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

/** 利用者を識別できないことを表す例外。errorResponse で 401 に変換する */
export class UnauthenticatedError extends Error {}

/** 本文が JSON として読めないことなどを表す例外。errorResponse で 400（validation）に変換する */
export class BadRequestError extends Error {}

export function jsonResponse(data: unknown, init?: ResponseInit): Response;
export function errorResponse(error: unknown): Response;
export async function readJsonBody(request: Request): Promise<unknown>;
export async function handleApi(fn: () => Promise<Response>): Promise<Response>;
```

- `jsonResponse(data, init)`: `data` を JSON にした本文と `Content-Type: application/json` の `Response` を返す（ステータスの既定は 200）。
- `errorResponse(error)`: 上の表に従って、エラー応答の `Response` を返す。
- `readJsonBody(request)`: 本文を JSON として読む。読めなければ `BadRequestError` を投げる。
- `handleApi(fn)`: `fn` を実行し、例外が投げられたら `errorResponse` に変換して返す。各 Route Handler は処理全体を `handleApi` で包む。

### 存在の秘匿

- 自分がメンバーでないグループに対する操作（取得・投稿・変更・削除など）は、グループが存在しない場合と同じく 404（`code: "not_found"`、`message: "グループが見つかりません"`）を返す。403 を返してグループの存在を知らせない。
- この規則は、グループを扱う各APIの仕様（`docs/specs/web-groups.md` など）で受け入れ条件にする。この仕様のAPIにはグループを扱うものがない。

### 日時

- JSON の日時は ISO 8601 の文字列（`Date.prototype.toJSON` の形、UTC、例: `"2026-09-28T12:34:56.789Z"`）にする。
- 画面側は受け取った文字列を必要に応じて `new Date(...)` で変換する。`apiFetch` は日時を変換しない。

### 利用者の識別（`src/server/session.ts`）

- Cookie に利用者IDをそのまま入れる。署名・暗号化はしない（判断1）。
- Cookie の名前は `type_chat_user_id`。
- 設定するときの属性は `HttpOnly`・`SameSite=Lax`・`Path=/`・`Max-Age=31536000`（1年＝365日の秒数）。`Secure` は付けない（公開環境では運用せず、ローカルの `http://` で動かすため。ADR 0001）。
- 削除するときは、同じ名前・`Path=/` で値を空にし、`Max-Age=0` にする。
- Cookie の値が UUID の形でないとき、または Cookie の利用者がDBに存在しないとき（DBを作り直した場合など）は、Cookie がないのと同じく「利用者がいない」とする。

```ts
export const USER_COOKIE_NAME = "type_chat_user_id";
export const USER_COOKIE_MAX_AGE = 31536000;

/** Request の Cookie ヘッダーから現在の利用者を読む。いなければ null */
export async function getCurrentUser(request: Request, users: UserRepository): Promise<User | null>;

/** getCurrentUser と同じ。いなければ UnauthenticatedError を投げる（API で 401 になる） */
export async function requireCurrentUser(request: Request, users: UserRepository): Promise<User>;

/** Server Component から現在の利用者を読む（next/headers の cookies() を使う）。いなければ null */
export async function getCurrentUserInPage(): Promise<User | null>;

/** getCurrentUserInPage と同じ。いなければ /start へリダイレクトする（next/navigation の redirect） */
export async function requireCurrentUserInPage(): Promise<User>;

/** Cookie を設定する Set-Cookie ヘッダーの値 */
export function buildUserCookie(userId: string): string;

/** Cookie を削除する Set-Cookie ヘッダーの値 */
export function buildClearUserCookie(): string;
```

- `getCurrentUserInPage`・`requireCurrentUserInPage` は、`createUserRepository(getDb())` で利用者を探す（`docs/specs/persistence.md`）。
- 利用者を要する画面（ホーム・チャット・設定）は `requireCurrentUserInPage` を呼ぶ。利用者を要するAPIは `requireCurrentUser` を呼ぶ。

### 利用者名（`src/user.ts`）

```ts
export const USER_NAME_MAX_LENGTH = 30;

export function createUser(name: string): User;
```

- `createUser` は `name` をトリムする（既存どおり）。
- トリム後が空なら、`DomainError`（`code: "validation"`、文言 `ユーザー名は空にできません`）を投げる。文言は既存のまま、例外を `Error` から `DomainError` に変える（API で 400 にするため）。
- トリム後の `name` の長さ（`String.prototype.length`。`GROUP_NAME_MAX_LENGTH` と同じ数え方）が `USER_NAME_MAX_LENGTH`（30）を超えたら、`DomainError`（`code: "validation"`、文言 `ユーザー名は30文字以内で入力してください`）を投げる（新規）。
- 名前の重複はドメインでは検査しない（既存の利用者の一覧が要るため）。ユースケース（`src/server/users.ts`）で検査する。

### ユースケース（`src/server/users.ts`）

```ts
export async function listUsers(users: UserRepository): Promise<User[]>;
export async function registerUser(users: UserRepository, name: string): Promise<User>;
export async function findUserToSwitch(users: UserRepository, userId: string): Promise<User>;
```

- `listUsers`: すべての利用者を登録順（`UserRepository.list()` の順）で返す。
- `registerUser`: `createUser(name)` で利用者を作る（空・30文字超は `createUser` の `DomainError`）。トリム後の名前が既存の利用者の `name` と完全に一致したら（大文字・小文字、全角・半角も区別する）、`DomainError`（`code: "conflict"`、文言 `その名前はすでに使われています`）を投げ、保存しない（判断3）。一致しなければ `UserRepository.insert` で保存し、その利用者を返す。
- `findUserToSwitch`: `userId` の利用者を返す。いなければ `DomainError`（`code: "not_found"`、文言 `利用者が見つかりません`）を投げる。

### 利用者のAPI

いずれも、現在の利用者がいなくても呼べる（利用を始める前に使うため）。Route Handler は `createUserRepository(getDb())` でリポジトリを作り、処理全体を `handleApi` で包む。

#### `src/app/api/users/route.ts`

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `GET /api/users` | なし | 200 `{ "users": [{ "id": string, "name": string }] }`（登録順） | - |
| `POST /api/users` | `{ "name": string }` | 201 `{ "user": { "id": string, "name": string } }` と、その利用者の Cookie を設定する `Set-Cookie` | 400（空・30文字超・本文の形式）、409（名前の重複） |

- `POST /api/users` は、名前を指定して利用者を登録し、その利用者として利用を開始する。すでに別の利用者の Cookie があっても、新しい利用者の Cookie で上書きする。
- `name` が文字列でない（ない・数値など）ときは 400（`リクエストの形式が正しくありません`）。

#### `src/app/api/session/route.ts`

| メソッド | リクエストの本文 | 成功の応答 | 失敗 |
| --- | --- | --- | --- |
| `PUT /api/session` | `{ "userId": string }` | 200 `{ "user": { "id": string, "name": string } }` と、その利用者の Cookie を設定する `Set-Cookie` | 400（本文の形式）、404（利用者が存在しない） |
| `DELETE /api/session` | なし | 204（本文なし）と、Cookie を削除する `Set-Cookie` | - |

- `PUT /api/session` は、既存の利用者に切り替える（判断2）。
- `DELETE /api/session` は、利用を終える。Cookie がないときも 204 を返す（何度呼んでもよい）。
- 上の表にないメソッドは Next.js の既定の 405 に任せる。

### APIクライアント（`src/lib/api-client.ts`）

```ts
export type ApiError = { code: string; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function apiFetch<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown },
): Promise<ApiResult<T>>;
```

- `fetch` を包む。`method` の既定は `GET`。`body` を渡したら `JSON.stringify` した本文と `Content-Type: application/json` を付ける。
- 2xx の応答: `{ ok: true, data }`。`data` は本文を JSON として読んだもの。204（本文なし）のときは `null`。
- 2xx 以外で、本文が `{ error: { code: string, message: string } }` の形: `{ ok: false, error: { code, message } }`（本文の値をそのまま使う）。
- 2xx 以外で、本文がその形でない（JSON でないなど）: `{ ok: false, error: { code: "internal", message: "サーバーでエラーが発生しました" } }`。
- `fetch` 自体が例外を投げた（通信エラー）: `{ ok: false, error: { code: "network", message: "通信に失敗しました。接続を確認してもう一度お試しください" } }`。例外を呼び出し側に投げない。
- 401 を受け取っても、`apiFetch` は画面の移動をしない（呼び出し側が `message` をトーストで出す。`docs/specs/ui-foundation.md` の「フィードバック」）。

### 画面

UI の規約（テーマトークンだけを使う、主操作は1画面1つ、`h1` は1つ、フィードバックの出し方など）は `docs/specs/ui-foundation.md` に従う。

#### 利用開始（`/start`、`src/app/start/page.tsx`）

- Server Component。`getCurrentUserInPage()` で利用者がいれば、ホーム（`/`）へリダイレクトする。
- 利用者がいなければ、`h1`「type-chat をはじめる」と、`listUsers` で読んだ既存の利用者の一覧（`id`・`name`）を渡した `StartForm` を描画する。

#### 開始フォーム（`src/components/start-form.tsx`）

```tsx
export type StartFormProps = { users: { id: string; name: string }[] };

export function StartForm(props: StartFormProps): React.JSX.Element;
```

Client Component。2つの区画を描画する。

1. **新しい名前ではじめる**（`form` 要素）
   - ラベル「名前」の入力欄と、「はじめる」ボタン（`variant="default"`。この画面の主操作）。
   - 入力欄がトリム後に空の間は、「はじめる」を `disabled` にする。
   - 送信前の検査: トリム後が30文字を超えたら、APIを呼ばずに入力欄の直下に `ユーザー名は30文字以内で入力してください` を出す。
   - 送信すると `apiFetch("/api/users", { method: "POST", body: { name } })` を呼ぶ。送信中は「はじめる」を `disabled` にし、文言を「開始中…」にする。
   - 成功したら `toast.success("利用を開始しました")` を出し、`router.replace("/")` と `router.refresh()` を呼ぶ（共通ヘッダーの利用者メニューを描画し直すため）。
   - 失敗が `validation`・`conflict` のときは、APIの `message` を入力欄の直下に出す（`aria-invalid="true"`・`aria-describedby`）。それ以外の失敗は `toast.error(message)` で出す。
2. **既存の利用者で入り直す**（判断2）
   - `users` が1人以上のときだけ描画する（見出しは `h2`「前に使った名前で入り直す」）。0人なら区画ごと描画しない。
   - 利用者ごとに、名前を文言にした `variant="outline"` のボタンを並べる。
   - 押すと `apiFetch("/api/session", { method: "PUT", body: { userId } })` を呼ぶ。送信中は一覧のボタンをすべて `disabled` にし、押したボタンの文言を「切り替え中…」にする。
   - 成功したら `toast.success("利用を再開しました")` を出し、`router.replace("/")` と `router.refresh()` を呼ぶ。失敗したら `toast.error(message)` で出す。

#### 利用者メニュー（`src/components/user-menu.tsx`）

```tsx
export type UserMenuProps = { userName: string };

export function UserMenu(props: UserMenuProps): React.JSX.Element;
```

- Client Component。shadcn/ui の `DropdownMenu` で、トリガーのボタンに利用者名を表示する。
- メニューに「利用者を切り替える」の項目を置く。確認ダイアログは出さない（取り消せない操作ではないため。`docs/specs/ui-foundation.md`）。
- 「利用者を切り替える」を選ぶと、`apiFetch("/api/session", { method: "DELETE" })` を呼ぶ。成功したら `toast.success("利用を終了しました")` を出し、`router.replace("/start")` と `router.refresh()` を呼ぶ。失敗したら `toast.error(message)` で出す。

#### 共通ヘッダーとルートレイアウト

- `src/components/app-header.tsx`: `AppHeader` に省略可能な `userName?: string | null` を足す。`userName` があれば、右端に `UserMenu` を描画する。なければ（省略・`null`）利用者メニューを描画しない（`/start` など）。それ以外の振る舞い（アプリ名のリンク、`h1` にしない）は `docs/specs/ui-foundation.md` のまま。
- `src/app/layout.tsx`: `getCurrentUserInPage()` で現在の利用者を読み、その `name`（いなければ `null`）を `AppHeader` の `userName` に渡す。

### 追加・変更するファイル

| パス | 内容 | 実装の区分 |
| --- | --- | --- |
| `src/server/http.ts` | エラー応答・JSON 応答の補助 | API（サーバー側） |
| `src/server/session.ts` | Cookie からの利用者の読み取り・リダイレクト・Cookie の設定と削除 | API（サーバー側） |
| `src/server/users.ts` | 利用者の一覧・登録・切り替えのユースケース | API（サーバー側） |
| `src/user.ts` | `USER_NAME_MAX_LENGTH` と最大長の検査、例外を `DomainError` に | API（サーバー側） |
| `src/app/api/users/route.ts` | `GET`・`POST /api/users` | API（サーバー側） |
| `src/app/api/session/route.ts` | `PUT`・`DELETE /api/session` | API（サーバー側） |
| `src/lib/api-client.ts` | `apiFetch` | 画面とAPIクライアント |
| `src/app/start/page.tsx` | 利用開始の画面 | 画面とAPIクライアント |
| `src/components/start-form.tsx` | 開始フォーム | 画面とAPIクライアント |
| `src/components/user-menu.tsx` | 利用者メニュー | 画面とAPIクライアント |
| `src/components/app-header.tsx` | 右端に利用者メニュー | 画面とAPIクライアント |
| `src/app/layout.tsx` | 現在の利用者を共通ヘッダーに渡す | 画面とAPIクライアント |

### テスト

- Route Handler のテストは、`Request` を作ってエクスポートされたハンドラ（`GET`・`POST`・`PUT`・`DELETE`）を直接呼ぶ。DB は `vi.mock` で `getDb` を `createDb(":memory:")` のDBに差し替える（`data/type-chat.db` を作らない。`docs/specs/persistence.md`）。
- `getCurrentUserInPage`・`requireCurrentUserInPage` のテストは、`next/headers` の `cookies` と `next/navigation` の `redirect` を `vi.mock` で差し替える。
- 画面部品のテストは `docs/specs/ui-foundation.md` の「テスト」に従う（`*.test.tsx`、Testing Library、jsdom）。`next/navigation` の `useRouter` と `apiFetch`（または `fetch`）は `vi.mock` で差し替える。

## 受け入れ条件

### API（サーバー側）

エラー応答（`src/server/http.ts`）

- [ ] `errorResponse(new DomainError("validation", "文言"))` のステータスが 400、本文が `{ error: { code: "validation", message: "文言" } }` である
- [ ] `errorResponse` が `DomainError` の `forbidden` を 403、本文の `code` を `"forbidden"` にする
- [ ] `errorResponse` が `DomainError` の `not_found` を 404、本文の `code` を `"not_found"` にする
- [ ] `errorResponse` が `DomainError` の `conflict` を 409、本文の `code` を `"conflict"` にする
- [ ] `errorResponse(new UnauthenticatedError())` のステータスが 401、本文が `{ error: { code: "unauthenticated", message: "利用を開始してください" } }` である
- [ ] `errorResponse(new Error("SQLITE_CONSTRAINT: secret"))` のステータスが 500、本文が `{ error: { code: "internal", message: "サーバーでエラーが発生しました" } }` で、本文に `SQLITE_CONSTRAINT` を含まない
- [ ] `errorResponse` が返す応答の `Content-Type` が `application/json` である
- [ ] `readJsonBody` に JSON として読めない本文の `Request` を渡すと、`handleApi` の応答が 400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）になる
- [ ] `jsonResponse({ at: new Date("2026-09-28T12:34:56.789Z") })` の本文の `at` が文字列 `"2026-09-28T12:34:56.789Z"` である

利用者の識別（`src/server/session.ts`）

- [ ] `buildUserCookie(id)` の値が `type_chat_user_id=<id>` で始まり、値が利用者IDそのもの（署名などを付けない）である
- [ ] `buildUserCookie(id)` の値に `HttpOnly`・`SameSite=Lax`・`Path=/`・`Max-Age=31536000` が含まれる
- [ ] `buildClearUserCookie()` の値が `type_chat_user_id=` で始まり、`Max-Age=0` と `Path=/` を含む
- [ ] Cookie ヘッダーのない `Request` で `getCurrentUser` を呼ぶと `null` が返る
- [ ] 登録済みの利用者のIDを `type_chat_user_id` に入れた `Request` で `getCurrentUser` を呼ぶと、その利用者が返る
- [ ] 存在しない利用者のID（UUID の形）を Cookie に入れた `Request` で `getCurrentUser` を呼ぶと `null` が返る
- [ ] UUID の形でない値を Cookie に入れた `Request` で `getCurrentUser` を呼ぶと `null` が返る
- [ ] Cookie ヘッダーのない `Request` で `requireCurrentUser` を呼ぶ処理を `handleApi` で包むと、401（`code: "unauthenticated"`）の応答になる
- [ ] Cookie のない状態で `getCurrentUserInPage` を呼ぶと `null` が返る（`cookies` を差し替える）
- [ ] 登録済みの利用者の Cookie がある状態で `getCurrentUserInPage` を呼ぶと、その利用者が返る
- [ ] Cookie のない状態で `requireCurrentUserInPage` を呼ぶと、`redirect("/start")` が呼ばれる（`redirect` を差し替える）

利用者名（`src/user.ts`）

- [ ] `createUser` に30文字ちょうどの名前を渡すと、その名前の `User` が返る
- [ ] `createUser` に前後の空白を除いて30文字の名前を渡すと、トリムされた名前の `User` が返る
- [ ] `createUser` に31文字の名前を渡すと、`code` が `"validation"`、文言が `ユーザー名は30文字以内で入力してください` の `DomainError` が投げられる
- [ ] `createUser` にトリム後が空の名前を渡すと、`code` が `"validation"`、文言が `ユーザー名は空にできません` の `DomainError` が投げられる

利用者のAPI

- [ ] 利用者が0人のとき、`GET /api/users` が 200 と `{ users: [] }` を返す
- [ ] `GET /api/users` が、登録した利用者を登録順に `{ id, name }` の配列で返す
- [ ] `POST /api/users` に `{ name: "  たろう  " }` を送ると、201 と `{ user: { id, name: "たろう" } }` が返り、`GET /api/users` にその利用者が含まれる
- [ ] `POST /api/users` の応答の `Set-Cookie` が、作った利用者の `id` を値とし、`HttpOnly`・`SameSite=Lax`・`Path=/`・`Max-Age=31536000` を含む
- [ ] `POST /api/users` に空白だけの名前を送ると、400（`code: "validation"`）が返り、利用者が増えない
- [ ] `POST /api/users` に31文字の名前を送ると、400（`code: "validation"`、`message: "ユーザー名は30文字以内で入力してください"`）が返る
- [ ] `POST /api/users` に `name` のない本文を送ると、400（`code: "validation"`、`message: "リクエストの形式が正しくありません"`）が返る
- [ ] 登録済みの名前と同じ名前で `POST /api/users` を送ると、409（`code: "conflict"`、`message: "その名前はすでに使われています"`）が返り、利用者が増えず、`Set-Cookie` がない
- [ ] 登録済みの名前の前後に空白を付けた名前で `POST /api/users` を送ると、409（`code: "conflict"`）が返る
- [ ] 登録済みの名前と大文字・小文字だけが違う名前で `POST /api/users` を送ると、201 で登録できる
- [ ] `PUT /api/session` に登録済みの利用者の `userId` を送ると、200 と `{ user: { id, name } }` が返り、`Set-Cookie` がその利用者の `id` を値とする
- [ ] `PUT /api/session` に存在しない `userId` を送ると、404（`code: "not_found"`、`message: "利用者が見つかりません"`）が返り、`Set-Cookie` がない
- [ ] `PUT /api/session` に `userId` のない本文を送ると、400（`code: "validation"`）が返る
- [ ] `DELETE /api/session` が 204 を返し、`Set-Cookie` が `type_chat_user_id=` で始まり `Max-Age=0` を含む
- [ ] Cookie のない `Request` で `DELETE /api/session` を呼んでも 204 が返る

### 画面とAPIクライアント

APIクライアント（`src/lib/api-client.ts`）

- [ ] 200 と JSON の本文を返す `fetch` のとき、`apiFetch` が `{ ok: true, data: <本文> }` を返す
- [ ] 204 を返す `fetch` のとき、`apiFetch` が `{ ok: true, data: null }` を返す
- [ ] `body` を渡すと、`fetch` に `JSON.stringify(body)` の本文と `Content-Type: application/json` のヘッダーが渡る
- [ ] `method` を省略すると、`fetch` に `GET` が渡る
- [ ] 409 と `{ error: { code: "conflict", message: "その名前はすでに使われています" } }` を返す `fetch` のとき、`apiFetch` が `{ ok: false, error: { code: "conflict", message: "その名前はすでに使われています" } }` を返す
- [ ] 500 と JSON でない本文を返す `fetch` のとき、`apiFetch` が `{ ok: false, error: { code: "internal", message: "サーバーでエラーが発生しました" } }` を返す
- [ ] `fetch` が例外を投げたとき、`apiFetch` が例外を投げずに `{ ok: false, error: { code: "network", message: "通信に失敗しました。接続を確認してもう一度お試しください" } }` を返す

利用開始の画面と開始フォーム

- [ ] 利用者の Cookie がある状態で `/start` のページを描画すると、`redirect("/")` が呼ばれる
- [ ] 利用者の Cookie がない状態で `/start` のページを描画すると、`h1`「type-chat をはじめる」が1つだけあり、開始フォームが描画される
- [ ] `StartForm` の入力欄が空（空白だけを含む）の間、「はじめる」ボタンが無効である
- [ ] `StartForm` で名前を入れて「はじめる」を押すと、`POST /api/users` に `{ name }` が送られる
- [ ] `StartForm` の送信中は「はじめる」ボタンが無効で、文言が「開始中…」になる
- [ ] `StartForm` の登録が成功すると、`toast.success("利用を開始しました")` が呼ばれ、`router.replace("/")` と `router.refresh()` が呼ばれる
- [ ] `StartForm` に31文字の名前を入れて送信すると、APIを呼ばずに入力欄の直下に `ユーザー名は30文字以内で入力してください` が出て、入力欄が `aria-invalid="true"` になる
- [ ] `StartForm` の登録が 409（`conflict`）で失敗すると、入力欄の直下に `その名前はすでに使われています` が出て、入力欄の `aria-describedby` がその文言の要素を指す
- [ ] `StartForm` の登録が通信エラーで失敗すると、`toast.error` がその `message` で呼ばれ、入力欄の直下にはエラーが出ない
- [ ] `StartForm` に利用者を2人渡すと、見出し「前に使った名前で入り直す」と、それぞれの名前のボタンが描画される
- [ ] `StartForm` に空の `users` を渡すと、見出し「前に使った名前で入り直す」が描画されない
- [ ] `StartForm` の既存の利用者のボタンを押すと、`PUT /api/session` に `{ userId: <その利用者の id> }` が送られる
- [ ] `StartForm` の既存の利用者への切り替えが成功すると、`toast.success("利用を再開しました")` が呼ばれ、`router.replace("/")` と `router.refresh()` が呼ばれる
- [ ] `StartForm` の既存の利用者への切り替えが 404 で失敗すると、`toast.error("利用者が見つかりません")` が呼ばれる
- [ ] `StartForm` の既存の利用者のボタンのクラスに `bg-primary` が含まれない（主操作は「はじめる」だけ）

利用者メニューと共通ヘッダー

- [ ] `UserMenu` を描画すると、利用者名を文言とするボタンがある
- [ ] `UserMenu` のボタンを押してメニューを開くと、「利用者を切り替える」の項目がある
- [ ] `UserMenu` で「利用者を切り替える」を選ぶと、`DELETE /api/session` が呼ばれ、成功したら `toast.success("利用を終了しました")` と `router.replace("/start")`・`router.refresh()` が呼ばれる
- [ ] `UserMenu` で「利用者を切り替える」が失敗すると、`toast.error` がその `message` で呼ばれ、`router.replace` は呼ばれない
- [ ] `AppHeader` に `userName: "たろう"` を渡すと、`banner` ロールの要素の中に「たろう」のボタン（利用者メニュー）がある
- [ ] `AppHeader` に `userName` を渡さないと、利用者メニューのボタンがない
- [ ] 利用者の Cookie がある状態で `RootLayout` を描画すると、共通ヘッダーに利用者名のボタンがある

## 対象外

- パスワード・外部IDプロバイダ（OAuth など）・メールによる確認などの認証。利用者の識別は認証ではなく、なりすましを防げない（ADR 0001。公開環境では運用しない）
- Cookie の改ざん対策（署名・暗号化）。Cookie の値を書き換えれば、誰にでもなれる（判断1で許容した）
- `Secure` 属性・HTTPS 前提の設定
- 利用者名の変更、利用者の削除
- 名前の同時登録の競合（単一プロセス前提のため、同じ名前の登録がほぼ同時に届く場合の扱いは決めない。DB に UNIQUE 制約も付けない。`docs/specs/persistence.md`）
- 名前の比較での正規化（大文字・小文字、全角・半角、Unicode の正規化）。トリム以外は完全一致で比べる
- 現在の利用者を返すAPI（`GET /api/session` など）。画面は Server Component で `getCurrentUserInPage` を使う
- 401 を受け取ったときの `/start` への自動の移動（`apiFetch` はトーストで知らせるだけ）
- グループを扱うAPIでの存在の秘匿の実装とテスト（各APIの仕様で扱う）
- レート制限、CSRF トークン（`SameSite=Lax` のため、他のサイトからの `POST`・`PUT`・`DELETE` には Cookie が送られない）

## 関連

- Issue #138（この仕様書の下書き。gate承認 2026-09-28）、親Issue #133、実装タスク #151（API（サーバー側））・#152（画面とAPIクライアント）
- `docs/decisions/0001-web-app-stack.md`（Next.js の Route Handler、層構成、認証を扱わない判断、公開環境で運用しない）
- `docs/specs/data-model.md`（`DomainError` と `DomainErrorCode`）
- `docs/specs/persistence.md`（`UserRepository`・`createUserRepository`・`getDb`・`createDb(":memory:")`、利用者名の一意性をDBの制約にしない）
- `docs/specs/ui-foundation.md`（`/start` の位置づけ、`AppHeader` の右端、UI規約、フィードバックの出し方、画面のテスト）
- `src/server/http.ts`、`src/server/session.ts`、`src/server/users.ts`、`src/user.ts`
- `src/app/api/users/route.ts`、`src/app/api/session/route.ts`
- `src/app/start/page.tsx`、`src/components/start-form.tsx`、`src/components/user-menu.tsx`、`src/components/app-header.tsx`、`src/app/layout.tsx`
- `src/lib/api-client.ts`
