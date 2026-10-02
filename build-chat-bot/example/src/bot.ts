import { commands } from "./commands.ts";
import type { RateLimiter } from "./ratelimit.ts";
import type { Transport, Update } from "./transport.ts";

export class Bot {
  private transport: Transport;
  private limiter: RateLimiter;
  private allowedChatIds: Set<number>;

  constructor(transport: Transport, limiter: RateLimiter, allowedChatIds: Set<number>) {
    this.transport = transport;
    this.limiter = limiter;
    this.allowedChatIds = allowedChatIds;
  }

  /** One polling round. Returns the offset to pass next so updates are not
   *  reprocessed after a restart or retry. */
  async poll(offset: number): Promise<number> {
    const replies: Promise<void>[] = [];
    for (const update of await this.transport.getUpdates(offset)) {
      offset = Math.max(offset, update.update_id + 1);
      replies.push(this.handle(update));
    }
    const results = await Promise.allSettled(replies);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    return offset;
  }

  async handle(update: Update): Promise<void> {
    const message = update.message;
    if (!message?.text?.startsWith("/")) return;
    const chatId = message.chat.id;
    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) return;

    const verdict = this.limiter.check(String(chatId));
    if (verdict === "deny") return;
    if (verdict === "deny-notify") {
      await this.transport.sendMessage(chatId, "Rate limit reached — try again in a minute.");
      return;
    }

    const [name, ...rest] = message.text.slice(1).split(/\s+/);
    const command = commands[name];
    const text = command
      ? command.handle({ chatId, args: rest.join(" ") })
      : "Unknown command — try /help";
    await this.transport.sendMessage(chatId, text);
  }
}
