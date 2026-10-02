export const NOTICE =
  "Experimental, commissioned as a test of the IMD swarm. " +
  "It may not work as described. Read the code, start with small amounts, no warranty.";

export interface CommandContext {
  chatId: number;
  args: string;
}

interface Command {
  description: string;
  handle(ctx: CommandContext): string;
}

export const commands: Record<string, Command> = {
  start: {
    description: "show the welcome and the experimental notice",
    handle: () => `Hello — this bot is a test. ${NOTICE}`,
  },
  help: {
    description: "list the commands",
    handle: () =>
      Object.entries(commands)
        .map(([name, command]) => `/${name} — ${command.description}`)
        .join("\n"),
  },
  ping: {
    description: "check the bot is alive",
    handle: () => "pong",
  },
  echo: {
    description: "repeat the arguments back",
    handle: ({ args }) => args || "nothing to echo",
  },
};
