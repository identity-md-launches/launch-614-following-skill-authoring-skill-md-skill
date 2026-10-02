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

interface TelegramResponse {
  ok: boolean;
  result: unknown;
  description?: string;
}

/** Live transport: the Bot API over HTTPS via long polling. The token lives only
 *  inside the request URL built here — it is never logged or thrown. */
export class TelegramTransport implements Transport {
  private base: string;

  constructor(token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
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
    await this.call("sendMessage", { chat_id: chatId, text });
  }
}

/** Harness transport: returns its script once, then nothing, and records every
 *  outgoing message so a test can assert on what the bot would have said. */
export class ScriptedTransport implements Transport {
  private updates: Update[];
  readonly sent: { chatId: number; text: string }[] = [];

  constructor(updates: Update[]) {
    this.updates = updates;
  }

  async getUpdates(): Promise<Update[]> {
    const batch = this.updates;
    this.updates = [];
    return batch;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}
