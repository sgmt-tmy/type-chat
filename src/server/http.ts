import { DomainError, type DomainErrorCode } from "../errors";

export type ApiErrorCode = DomainErrorCode | "unauthenticated" | "internal";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

/** 利用者を識別できないことを表す例外。errorResponse で 401 に変換する */
export class UnauthenticatedError extends Error {}

/** 本文が JSON として読めないことなどを表す例外。errorResponse で 400（validation）に変換する */
export class BadRequestError extends Error {}

const BAD_REQUEST_MESSAGE = "リクエストの形式が正しくありません";

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorBody(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return jsonResponse(body, { status });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return errorBody(DOMAIN_STATUS[error.code], error.code, error.message);
  }
  if (error instanceof UnauthenticatedError) {
    return errorBody(401, "unauthenticated", "利用を開始してください");
  }
  if (error instanceof BadRequestError) {
    return errorBody(400, "validation", BAD_REQUEST_MESSAGE);
  }
  console.error(error);
  return errorBody(500, "internal", "サーバーでエラーが発生しました");
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError(BAD_REQUEST_MESSAGE);
  }
}

export async function handleApi(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}
