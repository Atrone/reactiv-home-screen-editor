import { serve } from "@hono/node-server";
import { createConfigurationService } from "./app";
import { loadServiceEnv, type ServiceEnv } from "./env";
import { createSqliteRepository, openDatabase } from "./repository";

let env: ServiceEnv;
try {
  env = loadServiceEnv();
} catch (error) {
  // Print the setup problem without a stack trace and exit non-zero.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const database = openDatabase(env.databasePath);
const app = createConfigurationService({ repository: createSqliteRepository(database), apiKey: env.apiKey, logRequests: true });

// Loopback only: this API is private to the app server running on the same machine.
const server = serve({ fetch: app.fetch, port: env.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Configuration service listening on http://127.0.0.1:${info.port} (database: ${env.databasePath})`);
});

/**
 * Stops accepting requests and closes the database so a restart (or `tsx watch` reload)
 * never leaves the port bound or the SQLite file locked.
 */
function shutdown(): void {
  // Close the listener first so no request starts against a closed database.
  server.close();
  database.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
