import assert from "node:assert/strict";
import { test } from "node:test";

import { holidayActive } from "./holidays.ts";

test("holiday ranges, including ones that wrap the new year", () => {
  const eid = { start: "03-20", end: "03-22" };
  assert.equal(holidayActive(eid, new Date(2027, 2, 21)), true);
  assert.equal(holidayActive(eid, new Date(2027, 2, 23)), false);
  const winter = { start: "12-24", end: "01-02" };
  assert.equal(holidayActive(winter, new Date(2026, 11, 31)), true);
  assert.equal(holidayActive(winter, new Date(2027, 0, 2)), true);
  assert.equal(holidayActive(winter, new Date(2027, 0, 3)), false);
});
