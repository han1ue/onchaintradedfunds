import { randomUUID } from "node:crypto";
import { assertDatabaseWrites, database } from "./database";

export async function withCollectorLease<T>(job: string, run: (token: string) => Promise<T>): Promise<T | undefined> {
  assertDatabaseWrites();
  const { sql, schema } = database();
  const token = randomUUID();
  const acquired = await sql.query(`INSERT INTO ${schema}.collector_progress(job,lease_token,lease_until)
    VALUES ($1,$2,clock_timestamp()+interval '240 seconds') ON CONFLICT (job) DO UPDATE
    SET lease_token=$2,lease_until=clock_timestamp()+interval '240 seconds'
    WHERE ${schema}.collector_progress.lease_until IS NULL OR ${schema}.collector_progress.lease_until < clock_timestamp()
    RETURNING job`, [job, token]);
  if (!acquired.length) return undefined;
  try {
    const result = await run(token);
    await sql.query(`UPDATE ${schema}.collector_progress SET lease_until=NULL,completed_at=clock_timestamp(),last_error=NULL WHERE job=$1 AND lease_token=$2`, [job,token]);
    return result;
  } catch (error) {
    await sql.query(`UPDATE ${schema}.collector_progress SET lease_until=NULL,last_error='COLLECTION_FAILED' WHERE job=$1 AND lease_token=$2`, [job,token]);
    throw error;
  }
}
