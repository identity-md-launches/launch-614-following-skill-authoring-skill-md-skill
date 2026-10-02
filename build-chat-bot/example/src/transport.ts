export interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

export interface Transport {
  getUpdates(offset: number): Promise<Update[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Queue sends per chat; claim an overall slot only when that chat is ready. */
class OutboundPacer {
  private nextByChat = new Map<number, number>();
  private queues = new Map<number, Promise<void>>();
  private nextOverall = 0;
  private clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  send(chatId: number, send: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(chatId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      await this.wait(chatId);
      await send();
    });
    this.queues.set(chatId, pending);
    return pending.finally(() => {
      if (this.queues.get(chatId) === pending) this.queues.delete(chatId);
    });
  }

  private async wait(chatId: number): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      for (const [id, next] of this.nextByChat) {
        if (next <= now) this.nextByChat.delete(id);
      }
      const sendAt = Math.max(now, this.nextByChat.get(chatId) ?? 0, this.nextOverall);
      if (sendAt > now) {
        await this.clock.sleep(sendAt - now);
        continue;
      }
      this.nextByChat.set(chatId, now + 1_000);
      this.nextOverall = now + 1_000 / 30;
      return;
    }
  }
}

interface TelegramResponse {
  ok: boolean;
  result: unknown;
  description?: string;
}

/** Live transport: the Bot API over HTTPS via long polling. The token lives only
 *  inside the request URL built here — it is never logged or thrown. */
export class TelegramTransport implements Transport {
  private base: string;
  private pacer: OutboundPacer;

  constructor(token: string, clock: Clock = systemClock) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.pacer = new OutboundPacer(clock);
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telegram ${method}: HTTP ${res.status}`);
    const json = (await res.json()) as TelegramResponse;
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? "failed"}`);
    return json.result;
  }

  async getUpdates(offset: number): Promise<Update[]> {
    return (await this.call("getUpdates", { offset, timeout: 30 })) as Update[];
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.pacer.send(chatId, async () => {
      await this.call("sendMessage", { chat_id: chatId, text });
    });
  }
}

/** Harness transport: returns its script once, then nothing, and records every
 *  outgoing message so a test can assert on what the bot would have said. */
export class ScriptedTransport implements Transport {
  private updates: Update[];
  private pacer: OutboundPacer;
  readonly sent: { chatId: number; text: string }[] = [];

  constructor(updates: Update[], clock: Clock = systemClock) {
    this.updates = updates;
    this.pacer = new OutboundPacer(clock);
  }

  async getUpdates(): Promise<Update[]> {
    const batch = this.updates;
    this.updates = [];
    return batch;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.pacer.send(chatId, async () => {
      this.sent.push({ chatId, text });
    });
  }
}
