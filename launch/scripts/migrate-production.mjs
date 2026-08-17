import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") {
  console.log("Skipping database migrations outside a production deployment.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for production database migrations.");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const migration = spawnSync(pnpm, ["run", "db:migrate"], {
  env: process.env,
  stdio: "inherit",
});

if (migration.error) throw migration.error;
process.exit(migration.status ?? 1);
