export type ApiError = { code: string; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const INTERNAL_ERROR: ApiError = {
  code: "internal",
  message: "サーバーでエラーが発生しました",
};

const NETWORK_ERROR: ApiError = {
  code: "network",
  message: "通信に失敗しました。接続を確認してもう一度お試しください",
};

function readApiError(body: unknown): ApiError | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code, message };
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "Content-Type": "application/json" };
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  let body: unknown;
  try {
    const text = await response.text();
    body = text === "" ? null : JSON.parse(text);
  } catch {
    if (response.ok) return { ok: true, data: null as T };
    return { ok: false, error: INTERNAL_ERROR };
  }

  if (response.ok) return { ok: true, data: body as T };
  return { ok: false, error: readApiError(body) ?? INTERNAL_ERROR };
}
