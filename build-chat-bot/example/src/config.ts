export interface Config {
  token: string;
  allowedChatIds: Set<number>;
  port: number;
  rateLimit: number;
  rateWindowMs: number;
}

/** Every secret and host-specific value arrives here and nowhere else. A missing
 *  token is a fast failure that names the variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set — copy env.example and fill it in");
  }
  const allowedChatIds = new Set(
    (env.ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number)
      .filter((id) => Number.isFinite(id)),
  );
  return {
    token,
    allowedChatIds,
    port: Number(env.PORT ?? 8080),
    rateLimit: Number(env.RATE_LIMIT ?? 5),
    rateWindowMs: Number(env.RATE_WINDOW_MS ?? 60_000),
  };
}
