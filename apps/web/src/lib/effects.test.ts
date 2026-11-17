import assert from "node:assert/strict";
import { test } from "node:test";

import { effectOf, jumboEmoji } from "./effects.ts";

const LIST = { "❤️": "hearts", "🎉": "confetti", "✨": "sparkles", "🌙": "stars" };

test("a message that is only a listed emoji plays its effect", () => {
  assert.equal(effectOf("❤️", LIST), "hearts");
  assert.equal(effectOf("❤", LIST), "hearts");
  assert.equal(effectOf(" 🎉 ", LIST), "confetti");
  assert.equal(effectOf("❤️ love you", LIST), null);
  assert.equal(effectOf("❤️❤️", LIST), null);
  assert.equal(effectOf("🌙", { "🌙": "rainbow" }), null);
});

test("one to three emoji alone show large", () => {
  assert.equal(jumboEmoji("😂"), true);
  assert.equal(jumboEmoji("❤️🔥😍"), true);
  assert.equal(jumboEmoji("👍🏽"), true);
  assert.equal(jumboEmoji("😂😂😂😂"), false);
  assert.equal(jumboEmoji("ok 👍"), false);
  assert.equal(jumboEmoji("123"), false);
});
