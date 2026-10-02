**Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.**

# echo-bot

A small self-hosted Telegram bot in TypeScript — the worked example of the
`build-chat-bot` skill, showing the smallest output that satisfies its criteria.
Zero runtime dependencies: Node 22.18 or later runs the TypeScript directly.

## Commands

| Command | What it does |
| --- | --- |
| `/start` | welcome plus the experimental notice |
| `/help` | list the commands |
| `/ping` | answers `pong` |
| `/echo <text>` | repeats the arguments back |

## Environment

Copy `env.example` and fill it in. Nothing secret lives in the tree.

| Variable | Meaning |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | required; from @BotFather |
| `ALLOWED_CHAT_IDS` | comma-separated allowlist; empty allows every chat |
| `PORT` | status page port (default 8080) |
| `RATE_LIMIT` | commands per window per chat (default 5) |
| `RATE_WINDOW_MS` | window length in ms (default 60000) |

## Run

```
node src/index.ts          # needs TELEGRAM_BOT_TOKEN in the environment
node src/index.ts --help   # usage and the notice
```

Inbound commands are rate-limited per chat; an over-limit sender gets one notice
per window and the rest are dropped. A status page with the experimental notice
and a `/healthz` endpoint listen on `PORT`.

## Test harness

```
node --test test/bot.test.ts
```

Needs no token and no network: `ScriptedTransport` feeds fixed updates to the bot
and records every reply, and the rate limiter's clock is injected. The harness
covers every command, the allowlist, env loading, and the limiter including its
window reset.

## Deploy

One process; long polling, so no public URL is needed for Telegram.

**Container**

```
docker build -t echo-bot .
docker run -d --name echo-bot --restart unless-stopped --env-file env echo-bot
docker logs -f echo-bot
docker stop echo-bot            # to stop
docker rm echo-bot              # roll back: rebuild the previous image and run it again
```

**systemd on a small VPS**

```
[Unit]
Description=echo-bot
After=network-online.target

[Service]
EnvironmentFile=/etc/echo-bot/env
WorkingDirectory=/opt/echo-bot
ExecStart=/usr/bin/node src/index.ts
Restart=on-failure
User=echobot

[Install]
WantedBy=multi-user.target
```

Put the filled env file at `/etc/echo-bot/env` with mode 600, then
`systemctl enable --now echo-bot`. Logs: `journalctl -u echo-bot -f`. Stop:
`systemctl stop echo-bot`. Roll back: restore the previous tree and
`systemctl restart echo-bot`.
