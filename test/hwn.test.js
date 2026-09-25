import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HwnLearner } from "../src/hwn.js";

function makeFixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wecom-hwn-"));
  const skillDirectory = path.join(root, "hwn");
  const workingDirectory = path.join(root, "runtime");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(skillDirectory, "persona.md"),
    "# Persona\n\n## Correction 记录\n\n- 暂无用户纠正记录。\n",
  );
  fs.writeFileSync(
    path.join(skillDirectory, "self.md"),
    "# Self\n\n## Correction 记录\n\n- 暂无用户纠正记录。\n",
  );
  fs.writeFileSync(
    path.join(skillDirectory, "meta.json"),
    `${JSON.stringify({ version: "v1", corrections_count: 0, memory_sources: [] }, null, 2)}\n`,
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = {
    codex: {
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      workingDirectory,
      httpsOnly: true,
      fastMode: false,
    },
    hwn: {
      enabled: true,
      ownerUserId: "owner",
      skillDirectory,
      observationBatchSize: 3,
      minimumConfidence: 0.8,
      maxMessageChars: 1_000,
      ...overrides,
    },
  };
  const frame = (userid, msgid = "message") => ({ body: { from: { userid }, msgid } });
  return { config, frame, root, skillDirectory, workingDirectory };
}

test("whoami works before an owner is configured", async (t) => {
  const fixture = makeFixture(t, { ownerUserId: "", enabled: false });
  const learner = new HwnLearner(fixture.config, { analyze: async () => ({ traits: [] }) });

  const result = await learner.handleMessage(fixture.frame("user-123"), "/hwn whoami");
  assert.deepEqual(result, {
    handled: true,
    response: "你的企业微信 UserID：user-123",
  });
});

test("whoami is recognized after a group-chat mention prefix", async (t) => {
  const fixture = makeFixture(t, { ownerUserId: "", enabled: false });
  const learner = new HwnLearner(fixture.config, { analyze: async () => ({ traits: [] }) });

  const result = await learner.handleMessage(
    fixture.frame("group-user"),
    "@智能机器人 /hwn whoami",
  );
  assert.equal(result.handled, true);
  assert.equal(result.response, "你的企业微信 UserID：group-user");
});

test("only the configured owner is captured and commands or bare links are ignored", async (t) => {
  const fixture = makeFixture(t);
  const learner = new HwnLearner(fixture.config, { analyze: async () => ({ traits: [] }) });

  await learner.handleMessage(fixture.frame("other", "1"), "别人的消息");
  await learner.handleMessage(fixture.frame("owner", "2"), "https://example.com");
  await learner.handleMessage(fixture.frame("owner", "3"), "/something");
  const quoted = fixture.frame("owner", "quoted");
  quoted.body.quote = { msgtype: "text", text: { content: "别人的原话" } };
  await learner.handleMessage(quoted, "我引用的内容");
  await learner.handleMessage(fixture.frame("owner", "4"), "这是本人的普通表达");

  const observations = fs.readFileSync(learner.observationsFile, "utf8").trim().split("\n");
  assert.equal(observations.length, 1);
  assert.equal(JSON.parse(observations[0]).text, "这是本人的普通表达");
  assert.equal(learner.getStatus().captured, 1);
});

test("feedback and fact require the owner and update the correct skill files", async (t) => {
  const fixture = makeFixture(t);
  const date = new Date("2026-09-25T08:00:00.000Z");
  const learner = new HwnLearner(fixture.config, {
    analyze: async () => ({ traits: [] }),
    now: () => date,
  });

  const denied = await learner.handleMessage(
    fixture.frame("other"),
    "/hwn feedback 我不爱用长句",
  );
  assert.match(denied.response, /没有更新/);

  await learner.handleMessage(
    fixture.frame("owner"),
    "/hwn feedback 我倾向直接给结论",
  );
  await learner.handleMessage(fixture.frame("owner"), "/hwn fact 我目前在上海");

  assert.match(
    fs.readFileSync(path.join(fixture.skillDirectory, "persona.md"), "utf8"),
    /表达修正：我倾向直接给结论/,
  );
  assert.match(
    fs.readFileSync(path.join(fixture.skillDirectory, "self.md"), "utf8"),
    /事实确认：我目前在上海/,
  );
  const meta = JSON.parse(fs.readFileSync(path.join(fixture.skillDirectory, "meta.json")));
  assert.equal(meta.version, "v3");
  assert.equal(meta.corrections_count, 2);
  assert.equal(meta.memory_sources[0].kind, "企业微信自动观察");
  assert.ok(fs.existsSync(path.join(learner.runtimeDirectory, "backups")));
});

test("a full batch adds only a well-supported high-confidence persona trait", async (t) => {
  const fixture = makeFixture(t);
  const learner = new HwnLearner(fixture.config, {
    analyze: async (observations) => {
      assert.equal(observations.length, 3);
      return {
        traits: [
          {
            text: "倾向先给结论，再补充理由",
            confidence: 0.91,
            evidence_indexes: [0, 1, 2],
          },
          {
            text: "证据不足的猜测",
            confidence: 0.99,
            evidence_indexes: [0, 1],
          },
        ],
      };
    },
  });

  await learner.handleMessage(fixture.frame("owner", "1"), "我觉得直接说结论更好");
  await learner.handleMessage(fixture.frame("owner", "2"), "先给我结论，然后解释");
  await learner.handleMessage(fixture.frame("owner", "3"), "结论放最前面吧");
  await learner.waitForIdle();

  const persona = fs.readFileSync(path.join(fixture.skillDirectory, "persona.md"), "utf8");
  assert.match(persona, /## 自动蒸馏记录/);
  assert.match(persona, /倾向先给结论，再补充理由/);
  assert.doesNotMatch(persona, /证据不足的猜测/);
  assert.deepEqual(learner.getStatus(), {
    enabled: true,
    ownerConfigured: true,
    captured: 3,
    processed: 3,
    pending: 0,
  });
  assert.equal(fs.readFileSync(learner.observationsFile, "utf8").trim().split("\n").length, 3);
});
