import "server-only";

import { sqlClient } from "@/server/db";
import { pingRedis } from "@/server/rate-limit";

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("HEALTH_CHECK_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getInfrastructureHealth() {
  const [database, redis] = await Promise.all([
    sqlClient
      ? within(sqlClient.unsafe("select 1").then(() => true), 2_000).catch(() => false)
      : false,
    within(pingRedis(), 2_000).catch(() => false),
  ]);

  return { database, redis };
}
