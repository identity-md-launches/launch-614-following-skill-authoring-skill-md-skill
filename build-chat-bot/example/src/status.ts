import { createServer } from "node:http";
import type { Server } from "node:http";
import { NOTICE } from "./commands.ts";

/** A tiny status surface so the host can check the process is alive. Every page it
 *  serves carries the experimental notice. */
export function startStatusServer(port: number): Server {
  const page = `<!doctype html>
<html lang="en">
  <body>
    <p><strong>${NOTICE}</strong></p>
    <h1>echo-bot</h1>
    <p>Status: running.</p>
  </body>
</html>`;
  return createServer((req, res) => {
    if (req.url === "/healthz") {
      res.end("ok\n");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page);
  }).listen(port);
}
