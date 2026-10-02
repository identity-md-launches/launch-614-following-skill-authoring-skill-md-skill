# Building a small self-hosted chat bot

What is true about the work regardless of the request: which transport each platform
offers, how secrets stay out of the tree, the fake-transport harness pattern, rate
limiting, and the deploy shapes worth writing down.

## Platform and transport

**Telegram, long polling.** The right default for a self-hosted bot. `getUpdates` with
a monotonically increasing `offset` and a `timeout` long-poll window; reply with
`sendMessage`. No public URL, no TLS, no signature scheme — one token and outbound
HTTPS only. Persist the offset (`update_id + 1` of the last update seen) or messages
are reprocessed after a restart.

**Telegram, webhook.** `setWebhook` to a public HTTPS URL; updates arrive as POSTs.
Only when the request demands push delivery or the host already has TLS terminated.

**Discord.** Two shapes and the request picks one. A Gateway websocket connection is
persistent, needs a websocket client, and requires declaring intents. An Interactions
HTTP endpoint needs a public URL, Ed25519 verification of the
`X-Signature-Ed25519`/`X-Signature-Timestamp` headers on every request, and a response
within three seconds or a deferred reply. If the requester has no public URL and no
stated preference, report the conflict rather than silently choosing the expensive
one.

## Secrets

Read every secret from the environment at boot and fail fast naming what is missing.
The conventional names: `TELEGRAM_BOT_TOKEN` or `DISCORD_BOT_TOKEN`,
`ALLOWED_CHAT_IDS` or `ALLOWED_GUILD_IDS`, `PORT` for any status page. Ship an
`env.example` with placeholders. Never write `.env` — it is protected on every
delivered tree and it is where tokens go to leak. Never log the token: on Telegram it
is inside the API URL path, so request URLs and upstream error bodies stay out of the
logs too.

## The harness pattern

Put every platform call behind one interface — `getUpdates(offset)` and
`sendMessage(chatId, text)`, or the Discord equivalents. The live transport wraps
`fetch`; the harness's scripted transport returns a fixed update list once and records
every reply. Then tests need no token, no network and no timing luck:

- feed one scripted update per command and assert the recorded reply;
- feed more updates than the limiter allows in one window and assert the excess is
  dropped or answered once — inject a clock (`now: () => number`) into the limiter so
  the window is a value, not a sleep;
- feed an update from a chat outside the allowlist and assert no reply was recorded.

`node --test` is enough. No framework, no mocks library.

## Rate limiting

Inbound: a fixed-window counter or token bucket keyed on the chat (Telegram) or the
user and guild (Discord), checked before the command runs. Five messages a minute per
chat is a sane default. On a denial, answer once per window or drop the update —
never run the command, and never queue a flood of "slow down" notices. Outbound: pace
`sendMessage`; Telegram's informal limits are roughly one message per second per chat
and thirty per second overall.

## Deploy notes to write

A person on a small VPS should be able to follow the README end to end:

- env: `--env-file` for docker or `EnvironmentFile=` for systemd, mode 600, never
  committed;
- supervision: a systemd unit with `Restart=on-failure`, or
  `docker run -d --restart unless-stopped`;
- logs: `journalctl -u <unit> -f` or `docker logs -f`;
- a container build that runs the TypeScript directly (Node 22.18 and later strips
  types natively) or a `tsc` step if the project compiles;
- how to stop the bot and how to roll back to the previous deploy.
