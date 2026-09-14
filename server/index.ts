import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closePools } from "./db.js";
const app = await buildApp();
app.server.once("close", () => {
  void closePools();
});
await app.listen({ host: process.env.HOST || "127.0.0.1", port: config.PORT });
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await closePools();
    process.exit(0);
  });
