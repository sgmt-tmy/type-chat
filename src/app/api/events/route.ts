import { getDb } from "@/db/client";
import { createUserRepository } from "@/db/user-repository";
import { formatSseEvent, SSE_PING, SSE_PING_INTERVAL_MS, subscribe } from "@/server/events";
import { handleApi } from "@/server/http";
import { requireCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleApi(async () => {
    const user = await requireCurrentUser(request, createUserRepository(getDb()));
    const encoder = new TextEncoder();
    let cleanup: () => void = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const unsubscribe = subscribe(user.id, (event) => write(formatSseEvent(event)));
        const timer = setInterval(() => write(SSE_PING), SSE_PING_INTERVAL_MS);
        cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(timer);
          request.signal.removeEventListener("abort", cleanup);
          try {
            controller.close();
          } catch {
            // すでに閉じている
          }
        };
        if (request.signal.aborted) cleanup();
        else request.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  });
}
