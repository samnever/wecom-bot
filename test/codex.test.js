import assert from "node:assert/strict";
import test from "node:test";

import { CodexResponder } from "../src/codex.js";

function createFakeCodex(chunks = ["测试", "测试回答"], finalResponse = "测试回答") {
  const started = [];
  return {
    started,
    startThread(options) {
      const calls = [];
      const thread = {
        calls,
        async runStreamed(prompt) {
          calls.push(prompt);
          return {
            events: (async function* () {
              for (const text of chunks) {
                yield {
                  type: "item.updated",
                  item: { id: "answer", type: "agent_message", text },
                };
              }
              yield {
                type: "item.completed",
                item: {
                  id: "answer",
                  type: "agent_message",
                  text: finalResponse,
                },
              };
              yield {
                type: "turn.completed",
                usage: {
                  input_tokens: 1,
                  cached_input_tokens: 0,
                  cache_write_input_tokens: 0,
                  output_tokens: 1,
                  reasoning_output_tokens: 0,
                },
              };
            })(),
          };
        },
      };
      started.push({ options, thread });
      return thread;
    },
  };
}

const config = {
  model: "gpt-6-luna",
  reasoningEffort: "low",
  workingDirectory: "C:\\isolated-runtime",
  maxConversations: 10,
  instructions: "只回答问题",
};

test("CodexResponder starts a Luna low thread and streams the final response", async () => {
  const fake = createFakeCodex();
  const responder = new CodexResponder(config, fake);
  const updates = [];

  const answer = await responder.generateAnswer("single:user", "测试问题", (text) => {
    updates.push(text);
  });

  assert.equal(answer, "测试回答");
  assert.deepEqual(updates, ["测试", "测试回答"]);
  assert.deepEqual(fake.started[0].options, {
    model: "gpt-6-luna",
    modelReasoningEffort: "low",
    sandboxMode: "read-only",
    workingDirectory: "C:\\isolated-runtime",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  assert.match(fake.started[0].thread.calls[0], /测试问题/);
  assert.match(fake.started[0].thread.calls[0], /只回答问题/);
});

test("CodexResponder keeps a separate thread for each conversation", async () => {
  const fake = createFakeCodex();
  const responder = new CodexResponder(config, fake);

  await responder.generateAnswer("single:first", "one");
  await responder.generateAnswer("single:first", "two");
  await responder.generateAnswer("group:second", "three");

  assert.equal(fake.started.length, 2);
  assert.equal(fake.started[0].thread.calls.length, 2);
  assert.equal(fake.started[1].thread.calls.length, 1);
});

test("CodexResponder serializes messages in the same conversation", async () => {
  let releaseFirst;
  const order = [];
  const fake = {
    startThread() {
      return {
        async runStreamed(prompt) {
          const first = prompt.includes("first");
          return {
            events: (async function* () {
              order.push(first ? "start-first" : "start-second");
              if (first) {
                await new Promise((resolve) => {
                  releaseFirst = resolve;
                });
              }
              order.push(first ? "end-first" : "end-second");
              yield {
                type: "item.completed",
                item: { id: "answer", type: "agent_message", text: "ok" },
              };
            })(),
          };
        },
      };
    },
  };
  const responder = new CodexResponder(config, fake);

  const first = responder.generateAnswer("same", "first");
  const second = responder.generateAnswer("same", "second");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["start-first"]);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["start-first", "end-first", "start-second", "end-second"]);
});

test("CodexResponder returns a safe fallback for an empty output", async () => {
  const responder = new CodexResponder(config, createFakeCodex([], ""));
  assert.equal(
    await responder.generateAnswer("single:user", "hello"),
    "模型没有返回可显示的文字。",
  );
});

test("CodexResponder surfaces a streamed turn failure", async () => {
  const fake = {
    startThread() {
      return {
        async runStreamed() {
          return {
            events: (async function* () {
              yield { type: "turn.failed", error: { message: "模型失败" } };
            })(),
          };
        },
      };
    },
  };
  const responder = new CodexResponder(config, fake);

  await assert.rejects(
    responder.generateAnswer("single:user", "hello"),
    /模型失败/,
  );
});
