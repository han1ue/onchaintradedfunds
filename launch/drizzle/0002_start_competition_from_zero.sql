WITH "competition_clock" AS (
  SELECT statement_timestamp() AS "starts_at"
)
UPDATE "competitions"
SET
  "starts_at" = "competition_clock"."starts_at",
  "ends_at" = "competition_clock"."starts_at" + interval '37 days',
  "updated_at" = "competition_clock"."starts_at"
FROM "competition_clock";
