import { pino, type Logger as PinoLogger } from "pino";
import { env } from "../config/env.js";

const { LOG_LEVEL, NODE_ENV } = env();

export const logger = pino({
  level: LOG_LEVEL,
  // Never let a key reach the log stream, even if a provider config is logged wholesale.
  redact: {
    paths: [
      "apiKey",
      "*.apiKey",
      "headers.authorization",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  ...(NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type Logger = PinoLogger;
