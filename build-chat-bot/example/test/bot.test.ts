import assert from "node:assert/strict";
import test from "node:test";

import { Bot } from "../src/bot.ts";
import { commands, NOTICE } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { ScriptedTransport } from "../src/transport.ts";
import type { Update } from "../src/transport.ts";

function update(id: number, text: string, chatId = 42): Update {
  return { update_id: id, message: { chat: { id: chatId }, text } };
}

function makeBot(updates: Update[], limit = 5, allowed: Set<number> = new Set()) {
  const transport = new ScriptedTransport(updates);
  let now = 0;
  const bot = new Bot(transport, new RateLimiter(limit, 60_000, () => now), allowed);
  return { bot, transport, tick: (ms: number) => (now += ms) };
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
