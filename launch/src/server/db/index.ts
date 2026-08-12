import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env, isDatabaseConfigured } from "@/server/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { launchSql?: ReturnType<typeof postgres> };

export const sqlClient = isDatabaseConfigured
  ? globalForDb.launchSql ?? postgres(env.DATABASE_URL!, { max: 5, prepare: false })
  : undefined;

if (process.env.NODE_ENV !== "production" && sqlClient) globalForDb.launchSql = sqlClient;

export const db = sqlClient ? drizzle(sqlClient, { schema }) : undefined;

export function requireDb() {
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  return db;
}
