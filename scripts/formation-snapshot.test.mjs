import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { uint, validate } from "./formation-snapshot.mjs";

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures", "formation-snapshot.json"), "utf8"),
);

test("accepts safe numbers and exact decimal strings", () => {
  assert.equal(uint(Number.MAX_SAFE_INTEGER, "nonce"), BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(uint("9007199254740993", "nonce"), 9_007_199_254_740_993n);
});

test("rejects every unsafe JavaScript number before BigInt conversion", () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.5, -1, NaN, Infinity]) {
    assert.throws(
      () => uint(value, "nonce"),
      /Invalid formation snapshot: nonce must be a non-negative safe integer/,
    );
  }
});

test("applies the safe-integer rule to nested snapshot values", () => {
  assert.throws(
    () => validate({
      ...fixture,
      marketCapsUsdWad: [Number.MAX_SAFE_INTEGER + 1, fixture.marketCapsUsdWad[1]],
    }),
    /Invalid formation snapshot: marketCapsUsdWad\[0\] must be a non-negative safe integer/,
  );
});
