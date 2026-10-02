import assert from "node:assert/strict";
import test from "node:test";

import { Bot } from "../src/bot.ts";
import { commands, NOTICE } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { ScriptedTransport, TelegramTransport } from "../src/transport.ts";
import type { Clock } from "../src/transport.ts";
import type { Update } from "../src/transport.ts";

function update(id: number, text: string, chatId = 42): Update {
  return { update_id: id, message: { chat: { id: chatId }, text } };
}

function makeBot(updates: Update[], limit = 5, allowed: Set<number> = new Set()) {
  const clock = new FakeClock();
  const transport = new ScriptedTransport(updates, clock);
  const bot = new Bot(transport, new RateLimiter(limit, 60_000, clock.now), allowed);
  return { bot, transport, tick: (ms: number) => (clock.time += ms) };
}

class FakeClock implements Clock {
  time = 0;
  readonly sleeps: number[] = [];

  now = () => this.time;

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
}

test("every command gets a reply", async () => {
  const updates = Object.keys(commands).map((name, i) => update(i + 1, `/${name}`));
  const { bot, transport } = makeBot(updates);
  await bot.poll(0);
  assert.equal(transport.sent.length, updates.length);
});

test("/ping replies pong and /echo repeats its arguments", async () => {
  const { bot, transport } = makeBot([update(1, "/ping"), update(2, "/echo hello world")]);
  await bot.poll(0);
  assert.equal(transport.sent[0].text, "pong");
  assert.equal(transport.sent[1].text, "hello world");
});

test("/start carries the experimental notice", async () => {
  const { bot, transport } = makeBot([update(1, "/start")]);
  await bot.poll(0);
  assert.ok(transport.sent[0].text.includes(NOTICE));
});

test("unknown commands get a pointer to /help and plain text is ignored", async () => {
  const { bot, transport } = makeBot([update(1, "/nope"), update(2, "hi")]);
  await bot.poll(0);
  assert.equal(transport.sent.length, 1);
  assert.match(transport.sent[0].text, /Unknown command/);
});

test("over-limit updates are answered once, then dropped", async () => {
  const updates = Array.from({ length: 8 }, (_, i) => update(i + 1, "/ping"));
  const { bot, transport } = makeBot(updates, 5);
  await bot.poll(0);
  assert.equal(transport.sent.length, 6);
  assert.equal(transport.sent[5].text, "Rate limit reached — try again in a minute.");
});

test("the limiter resets after the window passes", async () => {
  const { bot, transport, tick } = makeBot([], 2);
  await bot.handle(update(1, "/ping"));
  await bot.handle(update(2, "/ping"));
  await bot.handle(update(3, "/ping"));
  await bot.handle(update(4, "/ping"));
  tick(61_000);
  await bot.handle(update(5, "/ping"));
  assert.deepEqual(
    transport.sent.map((m) => m.text),
    ["pong", "pong", "Rate limit reached — try again in a minute.", "pong"],
  );
});

test("the limiter evicts expired chat slots", () => {
  let now = 0;
  const limiter = new RateLimiter(1, 1_000, () => now);
  limiter.check("old-one");
  limiter.check("old-two");
  now = 1_000;
  limiter.check("current");
  assert.equal((limiter as unknown as { slots: Map<string, unknown> }).slots.size, 1);
});

test("outbound messages to one chat wait one second", async () => {
  const clock = new FakeClock();
  const transport = new ScriptedTransport([], clock);
  await transport.sendMessage(42, "first");
  await transport.sendMessage(42, "second");
  assert.deepEqual(clock.sleeps, [1_000]);
  assert.equal(clock.time, 1_000);
});

test("more than thirty outbound messages are spread across a second", async () => {
  const clock = new FakeClock();
  const transport = new ScriptedTransport([], clock);
  const sentAt: number[] = [];
  for (let chatId = 0; chatId < 31; chatId += 1) {
    await transport.sendMessage(chatId, "message");
    sentAt.push(clock.time);
  }
  assert.equal(transport.sent.length, 31);
  assert.equal(sentAt.filter((time) => time < 1_000).length, 30);
  assert.ok(sentAt[30] >= 1_000);
});

test("a chat outside the allowlist gets nothing", async () => {
  const updates = [update(1, "/ping", 7), update(2, "/ping", 42)];
  const { bot, transport } = makeBot(updates, 5, new Set([42]));
  await bot.poll(0);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].chatId, 42);
});

test("config fails fast without a token and reads values only from env", () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN/);
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: "test-token", ALLOWED_CHAT_IDS: "1, 2" });
  assert.equal(config.token, "test-token");
  assert.deepEqual([...config.allowedChatIds], [1, 2]);
});

/** Sleep stays pending until the test advances time, like a real timer. */
class ManualClock implements Clock {
  time = 0;
  private timers: { at: number; resolve: () => void }[] = [];
  now = () => this.time;

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.time + ms, resolve }));
  }

  async advance(ms: number): Promise<void> {
    this.time += ms;
    const ready = this.timers.filter((timer) => timer.at <= this.time);
    this.timers = this.timers.filter((timer) => timer.at > this.time);
    for (const timer of ready) timer.resolve();
    // Drain the queue and transport promise continuations without real sleeps.
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  }
}

test("the outbound pacer evicts expired chat times", async () => {
  const clock = new FakeClock();
  const transport = new ScriptedTransport([], clock);
  for (let chatId = 0; chatId < 1_000; chatId += 1) {
    await transport.sendMessage(chatId, "message");
  }
  const pacer = (transport as unknown as {
    pacer: { nextByChat: Map<number, number>; queues: Map<number, Promise<void>> };
  }).pacer;
  assert.ok(pacer.nextByChat.size <= 31);
  clock.time += 1_000;
  await transport.sendMessage(1_000, "current");
  assert.equal(pacer.nextByChat.size, 1);
  assert.equal(pacer.queues.size, 0);
});

test("a polling batch queues chat A without holding up chat B", async () => {
  const clock = new ManualClock();
  const transport = new ScriptedTransport([
    update(1, "/echo first", 1),
    update(2, "/echo second", 1),
    update(3, "/echo other", 2),
  ], clock);
  const bot = new Bot(transport, new RateLimiter(5, 60_000, clock.now), new Set());
  const polling = bot.poll(0);
  await clock.advance(0);
  assert.deepEqual(transport.sent, [{ chatId: 1, text: "first" }]);
  await clock.advance(34);
  assert.deepEqual(transport.sent, [
    { chatId: 1, text: "first" }, { chatId: 2, text: "other" },
  ]);
  await clock.advance(966);
  assert.equal(await polling, 4);
  assert.deepEqual(transport.sent[2], { chatId: 1, text: "second" });
});

test("TelegramTransport paces actual fetch calls per chat and overall", async (t) => {
  const clock = new ManualClock();
  const sent: { chatId: number; text: string; at: number }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.ok(url.endsWith("/sendMessage"));
    const body = JSON.parse(init.body as string);
    sent.push({ chatId: body.chat_id, text: body.text, at: clock.now() });
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  });
  const transport = new TelegramTransport("test-token", clock);
  const sends = [transport.sendMessage(1, "first"), transport.sendMessage(1, "second")];
  for (let chatId = 2; chatId <= 31; chatId += 1) {
    sends.push(transport.sendMessage(chatId, "other"));
  }
  await clock.advance(0);
  assert.equal(sent.length, 1);
  await clock.advance(34);
  assert.equal(sent[1].chatId, 2);
  assert.equal(sent[1].at, 34);
  for (let i = 0; i < 30; i += 1) await clock.advance(34);
  await Promise.all(sends);
  assert.equal(sent.length, 32);
  const sameChat = sent.filter((message) => message.chatId === 1);
  assert.deepEqual(sameChat.map((message) => message.text), ["first", "second"]);
  assert.ok(sameChat[1].at - sameChat[0].at >= 1_000);
  for (let i = 1; i < sent.length; i += 1) {
    assert.ok(sent[i].at - sent[i - 1].at >= 1_000 / 30);
  }
  for (const message of sent) {
    assert.ok(sent.filter((other) => other.at >= message.at && other.at < message.at + 1_000).length <= 30);
  }
});
