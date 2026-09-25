import path from "node:path";
import os from "node:os";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function nonNegativeInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return value;
}

function numberInRange(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字`);
  }
  return value;
}

const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function boolean(name, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} 必须是 true 或 false`);
}

function reasoningEffort() {
  const value = process.env.CODEX_REASONING_EFFORT?.trim() || "low";
  if (!REASONING_EFFORTS.has(value)) {
    throw new Error(
      `CODEX_REASONING_EFFORT 必须是 ${[...REASONING_EFFORTS].join(", ")} 之一`,
    );
  }
  return value;
}

export function loadConfig() {
  return {
    codex: {
      model: process.env.CODEX_MODEL?.trim() || "gpt-5.6-luna",
      reasoningEffort: reasoningEffort(),
      httpsOnly: boolean("CODEX_HTTPS_ONLY", true),
      fastMode: boolean("CODEX_FAST_MODE"),
      maxRetries: nonNegativeInteger("CODEX_MAX_RETRIES", 1),
      retryDelayMs: nonNegativeInteger("CODEX_RETRY_DELAY_MS", 2_000),
      workingDirectory: path.resolve(
        process.cwd(),
        process.env.CODEX_WORKING_DIRECTORY?.trim() || ".codex-bot-runtime",
      ),
      maxConversations: positiveInteger("CODEX_MAX_CONVERSATIONS", 100),
      instructions:
        process.env.BOT_INSTRUCTIONS?.trim() ||
        "你是企业微信中的内部 AI 助手。回答准确、简洁，并在不确定时明确说明。不要执行命令、修改文件或访问网络，只回答用户的问题。",
    },
    wecom: {
      botId: required("WECOM_BOT_ID"),
      secret: required("WECOM_BOT_SECRET"),
      wsUrl: process.env.WECOM_WS_URL?.trim() || undefined,
    },
    hwn: {
      enabled: boolean("HWN_LEARNING_ENABLED"),
      ownerUserId: process.env.HWN_OWNER_USER_ID?.trim() || "",
      skillDirectory: path.resolve(
        process.env.HWN_SKILL_DIRECTORY?.trim() ||
          path.join(os.homedir(), ".codex", "skills", "hwn"),
      ),
      observationBatchSize: positiveInteger("HWN_OBSERVATION_BATCH_SIZE", 50),
      minimumConfidence: numberInRange("HWN_MIN_CONFIDENCE", 0.8, 0, 1),
      maxMessageChars: positiveInteger("HWN_MAX_MESSAGE_CHARS", 1_000),
    },
  };
}
