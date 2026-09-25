import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPrompt,
  getConversationKey,
  MessageDeduplicator,
  truncateUtf8,
} from "../src/message.js";

test("extractPrompt extracts text, voice and mixed text", () => {
  assert.equal(
    extractPrompt({ body: { msgtype: "text", text: { content: " 你好 " } } }),
    "你好",
  );
  assert.equal(
    extractPrompt({ body: { msgtype: "voice", voice: { content: "语音文字" } } }),
    "语音文字",
  );
  assert.equal(
    extractPrompt({
      body: {
        msgtype: "mixed",
        mixed: {
          msg_item: [
            { msgtype: "text", text: { content: "第一段" } },
            { msgtype: "image", image: { url: "https://example.invalid" } },
            { msgtype: "text", text: { content: "第二段" } },
          ],
        },
      },
    }),
    "第一段\n第二段",
  );
});

test("getConversationKey separates group and single conversations", () => {
  assert.equal(
    getConversationKey({ body: { chattype: "group", chatid: "group-one" } }),
    "group:group-one",
  );
  assert.equal(
    getConversationKey({ body: { chattype: "single", from: { userid: "user-one" } } }),
    "single:user-one",
  );
});

test("truncateUtf8 respects a byte limit without breaking Unicode", () => {
  const result = truncateUtf8("你".repeat(100), 100);
  assert.ok(Buffer.byteLength(result, "utf8") <= 100);
  assert.ok(result.endsWith("（回复过长，已截断）"));
});

test("MessageDeduplicator rejects a duplicate key", () => {
  const deduplicator = new MessageDeduplicator();
  assert.equal(deduplicator.hasSeen("one"), false);
  assert.equal(deduplicator.hasSeen("one"), true);
  assert.equal(deduplicator.hasSeen("two"), false);
});
