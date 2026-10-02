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

/** Reserve outbound send times before waiting, so concurrent callers share the
 *  same per-chat and overall limits. */
class OutboundPacer {
  private nextByChat = new Map<number, number>();
  private nextOverall = 0;
  private clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async wait(chatId: number): Promise<void> {
    const now = this.clock.now();
    const sendAt = Math.max(now, this.nextByChat.get(chatId) ?? 0, this.nextOverall);
    this.nextByChat.set(chatId, sendAt + 1_000);
    this.nextOverall = sendAt + 1_000 / 30;
    if (sendAt > now) await this.clock.sleep(sendAt - now);
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
    await this.pacer.wait(chatId);
    await this.call("sendMessage", { chat_id: chatId, text });
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
    await this.pacer.wait(chatId);
    this.sent.push({ chatId, text });
  }
}
