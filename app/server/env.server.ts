import { existsSync } from "node:fs";
import { z } from "zod";

const appServerEnvSchema = z.object({
  CONFIG_SERVICE_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).default("http://127.0.0.1:4000"),
  CONFIG_SERVICE_API_KEY: z
    .string({ error: "is not set. Run `npm run setup` to generate .env with a random key." })
    .min(32, "must be at least 32 characters. Run `npm run setup` to generate a random key."),
});

export type AppServerEnv = { configServiceUrl: string; configServiceApiKey: string };

let cached: AppServerEnv | undefined;

/**
 * Returns the app server's settings, loading and validating them on first use. Lazy so that
 * building or type-generating the app never requires secrets to be present.
 *
 * Server-only: the `.server.ts` suffix makes the build fail if browser code imports this file,
 * and none of these variables carry the `VITE_` prefix that would inline them into the bundle.
 *
 * @returns Validated settings.
 * @throws Error naming each missing or invalid variable.
 */
export function getAppServerEnv(): AppServerEnv {
  // Validate once per process; the values cannot change while it runs.
  if (cached) {
    return cached;
  }

  // Real environment variables win over .env, matching the configuration service.
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }

  const parsed = appServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")} ${issue.message}`).join("\n");
    throw new Error(`App server is missing configuration:\n${problems}`);
  }

  cached = { configServiceUrl: parsed.data.CONFIG_SERVICE_URL, configServiceApiKey: parsed.data.CONFIG_SERVICE_API_KEY };
  return cached;
}
