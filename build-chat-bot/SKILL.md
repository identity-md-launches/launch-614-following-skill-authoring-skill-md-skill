---
# Runnable, not a reference: the text only makes sense as "do this, and here is how
# we will know you did". It asks for a delivered bot with criteria, a budget and a
# judge; nothing in it would still be true with no job in front of it.
id: build-chat-bot
version: 1
description: Build a small self-hosted Telegram or Discord bot in TypeScript, with a token-free local test harness and deploy notes.
role: implement
kind: code
# No suite in the verifier's closed set installs npm packages and runs a TypeScript
# harness, so nothing is re-run: checks none, and the class-2 paths judge that pairs
# with it. Claiming verifier-rerun here would pretend a suite exists that does not.
judge: verifier-paths
checks: none
# Installing TypeScript, type definitions or a platform library needs the network;
# a zero-dependency build does not, but the request cannot be assumed to allow one.
requires:
  - network
# Platform transport notes and the fake-transport harness pattern ship beside this
# file; the skill reads itself so they reach the worker digest-pinned.
reads:
  - skill:build-chat-bot
# The request carries the platform, the command list and any options; one pass-through
# variable is all the skill needs.
variables:
  - objective
# The work is a new project in an empty or existing tree and the request decides its
# layout; no fixed path list can name it in advance, so the budget is any.
writes: any
objective: "{{objective}}"
acceptanceCriteria:
  - "the command set is exactly the commands the request names, each implemented and listed in the README"
  - "the harness command documented in the README passes with no network and no bot token, exercising every command and the rate limiter through a fake transport"
  - "every secret and host-specific value is read from an environment variable named in the README and in a committed env.example holding placeholders; no token or key literal appears in the tree"
  - "the notice 'Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.' appears verbatim at the top of the README, in the CLI's --help output, and on every page the bot serves"
  - "the README ends with deploy notes a person could follow on a small VPS or as a container: how to supply the environment, supervise and restart the process, view logs, and stop it"
---

You are building a program somebody else will host and pay for. The run has a fixed
budget, an empty or existing tree, and no live token: Telegram and Discord are never
contacted, and the harness — not a live bot — is what proves the work. When you stop
talking the run is over; a bot left "waiting on the API" has produced nothing.

1. Read the platform, the commands and any options from the request. Open
   `.imd/reads/skills/build-chat-bot/REFERENCE.md` for the transport and harness
   details. Do not explore an existing tree first.
2. Write the smallest project that serves the request: an env-validating entrypoint,
   a command router, a rate limiter, and the platform transport behind one interface.
3. Write the harness, run it, and fix what it reports before calling anything done.
   Then write the README and its deploy notes.

**The commands come from the request.** Implement exactly what it names — nothing
added, nothing dropped. If the request leaves a command's behavior open, pick the
smaller reading and note the choice in the README.

**Secrets come only from env.** The token is read at boot; a missing variable is a
fast failure that names it. Ship `env.example` with placeholders — never a real
value, never a `.env` file, and never print the token: on Telegram it sits inside the
API URL, so do not print request URLs or their error bodies either.

**The transport is fakeable.** Every platform call goes through one interface, and
the harness injects a fake that feeds scripted updates and records replies. That is
how the tests run with no token and no network — a harness that calls the real API
proves nothing here.

**Rate limit inbound.** A per-chat or per-user limiter decides before a command runs.
The harness shows an over-limit update is dropped or answered once, not processed
again. Pace outbound calls too.

**Label it experimental.** The notice in the criteria goes at the top of the README,
in `--help` output, and on any status or landing page the bot serves.

**Keep it small and self-hosted.** One process: long polling or a single HTTP
endpoint, in-memory state unless the request says otherwise. Prefer zero runtime
dependencies under Node's built-in TypeScript support; whatever you install is
committed as ordinary files — the judge runs with no network, so a dependency the
commit does not contain does not exist.

**When it cannot be done, say so.** If the request names no platform, no commands, or
contradicts itself, your final message is the only account the network gets: name
what is missing or in conflict. Never deliver a hollow bot that replies to nothing as
if it were done.
