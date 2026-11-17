import assert from "node:assert/strict";
import { test } from "node:test";

import { dayLabel, groupMessages } from "./chatGroups.ts";

const at = (h: number, m: number, day = 17) => new Date(2026, 10, day, h, m).toISOString();
const now = new Date(2026, 10, 17, 12, 0);

test("messages from one person within five minutes share a group", () => {
  const rows = groupMessages(
    [
      { id: "1", sender_id: "a", created_at: at(9, 0) },
      { id: "2", sender_id: "a", created_at: at(9, 4) },
      { id: "3", sender_id: "a", created_at: at(9, 10) },
      { id: "4", sender_id: "b", created_at: at(9, 11) },
    ],
    now,
  );
  assert.deepEqual(
    rows.map((r) => (r.kind === "day" ? r.label : r.items.map((m) => m.id).join(","))),
    ["Today", "1,2", "3", "4"],
  );
});

test("a new day starts a divider and a new group", () => {
  const rows = groupMessages(
    [
      { id: "1", sender_id: "a", created_at: at(23, 58, 16) },
      { id: "2", sender_id: "a", created_at: at(0, 1, 17) },
    ],
    now,
  );
  assert.deepEqual(
    rows.map((r) => (r.kind === "day" ? r.label : r.items.length)),
    ["Yesterday", 1, "Today", 1],
  );
});

test("older days show a date", () => {
  assert.equal(dayLabel(new Date(2026, 10, 17, 8), now), "Today");
  assert.notEqual(dayLabel(new Date(2026, 10, 10, 8), now), "Yesterday");
});
