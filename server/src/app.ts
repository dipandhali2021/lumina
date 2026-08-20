import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./config/env.js";
import { toAppError } from "./core/errors.js";
import { logger } from "./core/logger.js";
import { couponRouter } from "./routes/coupon.route.js";
import { generateRouter } from "./routes/generate.route.js";
import { healthRouter } from "./routes/health.route.js";
import { imagesRouter } from "./routes/images.route.js";

export function createApp() {
  const config = env();
  const app = express();

  // Needed for correct client IPs behind a dev proxy or a hosting load balancer,
  // which the rate limiter keys on.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      methods: ["GET", "POST"],
    })
  );
  app.use(express.json({ limit: "64kb" }));

  // Request id + access log.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header("x-request-id") ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const startedAt = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        },
        "request"
      );
    });
    next();
  });

  app.use("/api", healthRouter);
  app.use("/api", couponRouter);
  app.use("/api", generateRouter);
  app.use("/api", imagesRouter);

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: { code: "not_found", message: `No route for ${req.method} ${req.path}.` },
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = toAppError(err);
    logger.error({ err, code: appError.code, details: appError.details }, appError.message);
    if (res.headersSent) {
      res.end();
      return;
    }
    res
      .status(appError.status)
      .json({ error: { code: appError.code, message: appError.message } });
  });

  return app;
}
