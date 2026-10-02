import { Bot } from "./bot.ts";
import { commands, NOTICE } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { RateLimiter } from "./ratelimit.ts";
import { startStatusServer } from "./status.ts";
import { TelegramTransport } from "./transport.ts";

const USAGE = `echo-bot — a small self-hosted Telegram bot

${NOTICE}

Usage:
  node src/index.ts          run the bot
  node src/index.ts --help   show this text
  node --test test/bot.test.ts   run the harness (no token, no network)

Environment (see env.example):
  TELEGRAM_BOT_TOKEN   required
  ALLOWED_CHAT_IDS     comma-separated allowlist; empty allows every chat
  PORT                 status page port (default 8080)
  RATE_LIMIT           commands per window per chat (default 5)
  RATE_WINDOW_MS       window length in milliseconds (default 60000)

Commands: ${Object.keys(commands)
    .map((name) => `/${name}`)
    .join("  ")}
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const config = loadConfig(process.env);
const bot = new Bot(
  new TelegramTransport(config.token),
  new RateLimiter(config.rateLimit, config.rateWindowMs),
  config.allowedChatIds,
);
startStatusServer(config.port);

let offset = 0;
for (;;) {
  try {
    offset = await bot.poll(offset);
  } catch (error) {
    console.error("poll failed, retrying in 5s:", (error as Error).message);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
