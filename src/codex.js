import { Codex } from "@openai/codex-sdk";

export class CodexResponder {
  constructor(config, codex = new Codex()) {
    this.config = config;
    this.codex = codex;
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

  async generateAnswer(conversationKey, prompt, onUpdate = async () => {}) {
    const previous = this.queues.get(conversationKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const thread = this.getThread(conversationKey);
      const streamed = await thread.runStreamed(
        [
          "请严格遵守以下机器人说明：",
          this.config.instructions,
          "",
          "用户消息：",
          prompt,
          "",
          "直接给出适合在企业微信中发送的最终回答，不要描述内部执行过程。",
        ].join("\n"),
      );

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
        } else if (event.type === "turn.failed") {
          throw new Error(event.error.message);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }

      return finalResponse.trim() || lastUpdate.trim() || "模型没有返回可显示的文字。";
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
