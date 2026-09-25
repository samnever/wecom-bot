const MAX_WECOM_REPLY_BYTES = 20_000;

export function extractPrompt(frame) {
  const body = frame?.body;
  if (!body) return "";

  if (body.msgtype === "text") {
    return body.text?.content?.trim() || "";
  }

  if (body.msgtype === "voice") {
    return body.voice?.content?.trim() || "";
  }

  if (body.msgtype === "mixed") {
    return (body.mixed?.msg_item || [])
      .filter((item) => item?.msgtype === "text")
      .map((item) => item.text?.content?.trim())
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export function getConversationKey(frame) {
  const body = frame?.body;
  if (!body) return "unknown";

  return body.chattype === "group"
    ? `group:${body.chatid || "unknown"}`
    : `single:${body.from?.userid || "unknown"}`;
}

export function truncateUtf8(text, maxBytes = MAX_WECOM_REPLY_BYTES) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  const suffix = "\n\n（回复过长，已截断）";
  const budget = maxBytes - Buffer.byteLength(suffix, "utf8");
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= budget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, low)}${suffix}`;
}

export class MessageDeduplicator {
  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  hasSeen(key) {
    if (!key) return false;

    const now = Date.now();
    const expiresAt = this.seen.get(key);
    if (expiresAt && expiresAt > now) return true;

    this.seen.set(key, now + this.ttlMs);
    if (this.seen.size > 1_000) this.cleanup(now);
    return false;
  }

  cleanup(now = Date.now()) {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}
