// Creates .env from .env.example with a freshly generated API key. Safe to run repeatedly:
// an existing .env is never modified, so a key you set yourself is never replaced.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Writes `.env` if it does not exist yet.
 *
 * @returns Nothing; prints what it did.
 */
function main() {
  // Leave an existing file alone, whatever it contains.
  if (existsSync(".env")) {
    console.log("setup: .env already exists, leaving it unchanged.");
    return;
  }

  // 32 random bytes as base64url: 43 characters, valid in a Bearer token, never committed anywhere.
  const apiKey = randomBytes(32).toString("base64url");
  const template = readFileSync(".env.example", "utf8");
  const contents = template.replace(/^CONFIG_SERVICE_API_KEY=.*$/m, `CONFIG_SERVICE_API_KEY=${apiKey}`);

  // "wx" fails instead of overwriting if another process created the file in the meantime.
  writeFileSync(".env", contents, { flag: "wx" });
  console.log("setup: created .env with a random CONFIG_SERVICE_API_KEY.");
}

main();
