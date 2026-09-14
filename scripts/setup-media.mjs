import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { parse } from "dotenv";
const env = parse(readFileSync(".env", "utf8"));
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((item) => item?.family === "IPv4" && !item.internal)
  .map((item) => item.address)
  .filter((address) => !address.startsWith("169.254."));
const mediaAddress =
  addresses.find((address) => address.startsWith("192.168.")) ||
  addresses.find((address) => address.startsWith("10.")) ||
  addresses.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address)) ||
  addresses[0];
if (!mediaAddress)
  throw new Error("No local IPv4 address is available for WebRTC.");
const defaults = {
  LIVEKIT_INTERNAL_URL: "http://127.0.0.1:17880",
  LIVEKIT_API_KEY: "noctis" + randomBytes(12).toString("hex"),
  LIVEKIT_API_SECRET: randomBytes(32).toString("hex"),
  MEDIA_PUBLIC_IP: mediaAddress,
};
const entries = Object.entries(defaults).filter(([key]) => !env[key]);
if (entries.length)
  appendFileSync(
    ".env",
    "\n" + entries.map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    { mode: 0o600 },
  );
console.log(
  "Local SFU configuration ready. Existing credentials preserved; no secrets printed.",
);
