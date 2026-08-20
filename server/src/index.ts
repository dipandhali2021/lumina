/**
 * Boot sequence: validate env -> register providers -> prove every mode resolves ->
 * export the app. Anything misconfigured fails here rather than on a user's first request.
 *
 * The module serves two roles. Top-level await runs the one-time wiring and the
 * `export default` hands the app to Vercel, which provides the HTTP server itself.
 * Locally there is no such server, so the non-Vercel branch adds `.listen()` and the
 * signal handlers that only make sense in a long-running process.
 */
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

async function initialize() {
  let config;
  try {
    config = loadEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Imported after env validation so a missing key surfaces as the readable error above
  // rather than a module-init crash.
  const { logger } = await import("./core/logger.js");
  const { registerBuiltInProviders, assertProvidersResolvable } = await import(
    "./providers/registry.js"
  );

  try {
    registerBuiltInProviders();
    for (const wiring of assertProvidersResolvable()) {
      logger.info(wiring, `mode "${wiring.mode}" wired`);
    }
  } catch (err) {
    logger.fatal({ err }, "provider wiring failed");
    process.exit(1);
  }

  return { app: createApp(), config, logger };
}

const { app, config, logger } = await initialize();

export default app;

if (!process.env.VERCEL) {
  const server = app.listen(config.PORT, () => {
    logger.info(`listening on http://localhost:${config.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    // Don't hang forever on a stuck SSE connection.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
