import type { D1Database, ExecutionContext, R2Bucket, ScheduledController } from "@cloudflare/workers-types";
import { handleRequest, sweepExpired } from "./handle.ts";
import type { Env } from "./types.ts";
import { PAGE_SCRIPT } from "./page-script.ts";

export interface WorkerBindings {
  DB: D1Database;
  LOCKER_BUCKET: R2Bucket;
  LOCKER_HMAC_SECRET: string;
}

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env as unknown as Env, ctx, { pageScript: PAGE_SCRIPT });
  },
  async scheduled(
    _controller: ScheduledController,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(sweepExpired(env as unknown as Env, Date.now()));
  },
};