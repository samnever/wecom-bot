import { Codex } from "@openai/codex-sdk";

export function buildCodexOptions(config) {
  const codexConfig = {};

  if (config.fastMode) {
    codexConfig.service_tier = "fast";
    codexConfig.features = { fast_mode: true };
  }

  if (config.httpsOnly) {
    codexConfig.model_provider = "chatgpt_http";
    codexConfig.model_providers = {
      chatgpt_http: {
        name: "ChatGPT HTTP",
        base_url: "https://chatgpt.com/backend-api/codex",
        wire_api: "responses",
        requires_openai_auth: true,
        supports_websockets: false,
      },
    };
  }

  return Object.keys(codexConfig).length > 0 ? { config: codexConfig } : undefined;
}

export class CodexResponder {
  constructor(config, codex) {
    this.config = config;
    this.codex =
      codex ||
      new Codex(buildCodexOptions(config));
    this.conversations = new Map();
    this.queues = new Map();
  }

  getThread(conversationKey) {
    const existing = this.conversations.get(conversationKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.thread;
    }

    if (this.conversations.size >= this.config.maxConversations) {
      let oldestKey;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, value] of this.conversations) {
        if (value.lastUsedAt < oldestTime) {
          oldestKey = key;
          oldestTime = value.lastUsedAt;
        }
      }
      if (oldestKey !== undefined) this.conversations.delete(oldestKey);
    }

    const options = {
      sandboxMode: "read-only",
      workingDirectory: this.config.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    };
    if (this.config.model) options.model = this.config.model;
    if (this.config.reasoningEffort) {
      options.modelReasoningEffort = this.config.reasoningEffort;
    }

    const thread = this.codex.startThread(options);
    this.conversations.set(conversationKey, {
      thread,
      lastUsedAt: Date.now(),
    });
    return thread;
  }

  isRetryableConnectionError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /timed? out|timeout|workspace routing discovery failed|connection|stream disconnected/i.test(
      message,
    );
  }

  getReconnectProgress(message) {
    const match = String(message).match(/Reconnecting\.\.\.\s*(\d+)\/(\d+)/i);
    if (!match) return null;
    return { current: Number(match[1]), total: Number(match[2]) };
  }

  async waitBeforeRetry() {
    if (this.config.retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.retryDelayMs));
    }
  }

  async generateAnswer(conversationKey, prompt, onUpdate = async () => {}) {
    const previous = this.queues.get(conversationKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const input = [
        "请严格遵守以下机器人说明：",
        this.config.instructions,
        "",
        "用户消息：",
        prompt,
        "",
        "直接给出适合在企业微信中发送的最终回答，不要描述内部执行过程。",
      ].join("\n");

      for (let attempt = 0; ; attempt += 1) {
        try {
          const thread = this.getThread(conversationKey);
          const streamed = await thread.runStreamed(input);
          let finalResponse = "";
          let lastUpdate = "";

          for await (const event of streamed.events) {
            if (
              event.type === "item.updated" &&
              event.item.type === "agent_message" &&
              event.item.text &&
              event.item.text !== lastUpdate
            ) {
              lastUpdate = event.item.text;
              await onUpdate(lastUpdate);
            } else if (
              event.type === "item.completed" &&
              event.item.type === "agent_message"
            ) {
              finalResponse = event.item.text;
            } else if (event.type === "turn.failed" || event.type === "error") {
              const message =
                event.type === "turn.failed" ? event.error.message : event.message;
              const reconnect = this.getReconnectProgress(message);
              if (reconnect) {
                await onUpdate(
                  `模型连接超时，正在重连（${reconnect.current}/${reconnect.total}）…`,
                );
                continue;
              }
              throw new Error(message);
            }
          }

          return finalResponse.trim() || lastUpdate.trim() || "模型没有返回可显示的文字。";
        } catch (error) {
          if (
            attempt >= this.config.maxRetries ||
            !this.isRetryableConnectionError(error)
          ) {
            throw error;
          }

          this.conversations.delete(conversationKey);
          await onUpdate(
            `连接超时，正在重试（${attempt + 1}/${this.config.maxRetries}）…`,
          );
          await this.waitBeforeRetry();
        }
      }
    });

    this.queues.set(conversationKey, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(conversationKey) === current) {
        this.queues.delete(conversationKey);
      }
    }
  }
}
