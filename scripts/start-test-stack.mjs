import "dotenv/config";
import { spawn } from "node:child_process";
if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("The browser test stack requires a dedicated test database.");
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { env: process.env, stdio: "inherit" },
  ),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((p) => p.kill());
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exit(code || 0);
    }
  });
