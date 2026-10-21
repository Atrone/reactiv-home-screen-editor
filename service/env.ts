import { existsSync } from "node:fs";
import { z } from "zod";

const serviceEnvSchema = z.object({
  CONFIG_SERVICE_API_KEY: z
    .string({ error: "is not set. Run `npm run setup` to generate .env with a random key." })
    .min(32, "must be at least 32 characters. Run `npm run setup` to generate a random key."),
  CONFIG_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CONFIG_DB_PATH: z.string().min(1).default("./data/configurations.sqlite"),
});

export type ServiceEnv = { apiKey: string; port: number; databasePath: string };

/**
 * Reads and validates the service's environment. There is deliberately no fallback API key:
 * a missing key stops the process instead of starting an API anyone can call.
 *
 * @param env - Environment variables (defaults to process.env after loading .env).
 * @returns Validated settings.
 * @throws Error listing every invalid variable.
 */
export function loadServiceEnv(env: NodeJS.ProcessEnv = readProcessEnv()): ServiceEnv {
  const parsed = serviceEnvSchema.safeParse(env);
  if (!parsed.success) {
    // One line per problem, naming the variable, so setup mistakes are obvious.
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")} ${issue.message}`).join("\n");
    throw new Error(`Configuration service cannot start:\n${problems}`);
  }
  return {
    apiKey: parsed.data.CONFIG_SERVICE_API_KEY,
    port: parsed.data.CONFIG_SERVICE_PORT,
    databasePath: parsed.data.CONFIG_DB_PATH,
  };
}

/**
 * Loads `.env` (if present) into process.env. Variables already set in the real environment win.
 *
 * @returns process.env.
 */
function readProcessEnv(): NodeJS.ProcessEnv {
  // Node's built-in loader keeps existing variables, so CI or a shell export can override .env.
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  return process.env;
}
