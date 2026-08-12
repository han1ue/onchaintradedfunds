import { env } from "./env";
export function assertCron(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) throw new Error("FORBIDDEN");
}
