import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export function databaseSchema(env: Readonly<Record<string,string|undefined>> = process.env): string {
  const target = env.VERCEL_ENV || "development";
  if (target === "production") return "otf_production";
  if (target === "preview") {
    const branch = env.VERCEL_GIT_COMMIT_REF;
    if (!branch) throw new Error("Preview database isolation requires VERCEL_GIT_COMMIT_REF.");
    return `otf_preview_${createHash("sha256").update(branch).digest("hex").slice(0, 16)}`;
  }
  if (target !== "development") throw new Error("Unsupported database environment.");
  // Tests can use a disposable schema; they cannot opt into production or preview.
  const schema = env.REGISTRY_TEST_SCHEMA || "otf_development";
  if (schema !== "otf_development" && !/^otf_test_[a-z0-9_]{1,40}$/.test(schema)) throw new Error("Invalid test schema.");
  return schema;
}

export function assertDatabaseWrites(env: Readonly<Record<string,string|undefined>> = process.env) {
  if (databaseSchema(env) === "otf_production" && env.REGISTRY_PRODUCTION_WRITES !== "true") {
    throw new Error("Production registry writes require REGISTRY_PRODUCTION_WRITES=true.");
  }
}

export function database() {
  if (typeof window !== "undefined") throw new Error("The database is server-only.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return { sql: neon(url), schema: databaseSchema() };
}
