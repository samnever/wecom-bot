import "dotenv/config";

import fs from "node:fs";
import { WSClient, generateReqId } from "@wecom/aibot-node-sdk";

import { CodexResponder } from "./codex.js";
import { loadConfig } from "./config.js";
import { HwnLearner } from "./hwn.js";
import {
  extractPrompt,
  getConversationKey,
  MessageDeduplicator,
  truncateUtf8,
} from "./message.js";

const config = loadConfig();
fs.mkdirSync(config.codex.workingDirectory, { recursive: true });

const responder = new CodexResponder(config.codex);
const deduplicator = new MessageDeduplicator();
const hwnLearner = new HwnLearner(config);

const wecomOptions = {
  botId: config.wecom.botId,
  secret: config.wecom.secret,
  maxReconnectAttempts: -1,
  logger: {
    debug: () => {},
    info: (message) => console.log(`[企业微信] ${message}`),
    warn: (message) => console.warn(`[企业微信警告] ${message}`),
    error: (message) => console.error(`[企业微信错误] ${message}`),
  },
};

if (config.wecom.wsUrl) wecomOptions.wsUrl = config.wecom.wsUrl;
const wecom = new WSClient(wecomOptions);

async function handleMessage(frame) {
  const prompt = extractPrompt(frame);
  if (!prompt || deduplicator.hasSeen(frame?.body?.msgid)) return;

  const streamId = generateReqId("codex");

  try {
    const learningResult = await hwnLearner.handleMessage(frame, prompt);
    if (learningResult.handled) {
      await wecom.replyStream(
        frame,
        streamId,
        truncateUtf8(learningResult.response),
        true,
      );
      return;
    }

    await wecom.replyStream(frame, streamId, "正在思考…", false);
    const answer = await responder.generateAnswer(
      getConversationKey(frame),
      prompt,
      async (partialAnswer) => {
        try {
          await wecom.replyStreamNonBlocking(
            frame,
            streamId,
            truncateUtf8(partialAnswer),
            false,
          );
        } catch (streamError) {
          console.warn(
            "发送流式中间结果失败：",
            streamError instanceof Error ? streamError.message : streamError,
          );
        }
      },
    );
    await wecom.replyStream(frame, streamId, truncateUtf8(answer), true);
  } catch (error) {
    console.error("处理消息失败：", error instanceof Error ? error.message : error);

    try {
      await wecom.replyStream(
        frame,
        streamId,
        "抱歉，处理这条消息时出现了问题，请稍后再试。",
        true,
      );
    } catch (replyError) {
      console.error(
        "发送错误提示失败：",
        replyError instanceof Error ? replyError.message : replyError,
      );
    }
  }
}

wecom.on("authenticated", () => {
  console.log(
    `机器人已连接，Codex 模型：${config.codex.model}，推理强度：${config.codex.reasoningEffort}`,
  );
  if (config.hwn.enabled && !config.hwn.ownerUserId) {
    console.warn(
      "hwn 自动学习已启用，但尚未设置 HWN_OWNER_USER_ID；向机器人发送 /hwn whoami 获取你的 UserID。",
    );
  } else if (config.hwn.enabled) {
    console.log("hwn 自动学习已启用，仅记录指定所有者的消息。");
  }
});

wecom.on("message.text", handleMessage);
wecom.on("message.voice", handleMessage);
wecom.on("message.mixed", handleMessage);

wecom.on("event.enter_chat", async (frame) => {
  try {
    await wecom.replyWelcome(frame, {
      msgtype: "text",
      text: { content: "你好，我是 AI 助手。直接发送问题即可。" },
    });
  } catch (error) {
    console.error("发送欢迎语失败：", error instanceof Error ? error.message : error);
  }
});

function shutdown(signal) {
  console.log(`收到 ${signal}，正在断开连接…`);
  wecom.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error("未处理的异步错误：", reason);
});

wecom.connect();
