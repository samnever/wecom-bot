import path from "node:path";

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

const REASONING_EFFORTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

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
      model: process.env.CODEX_MODEL?.trim() || "gpt-6-luna",
      reasoningEffort: reasoningEffort(),
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
  };
}
