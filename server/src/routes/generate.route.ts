/**
 * POST /api/generate — streams pipeline stages to the browser over SSE.
 *
 * The route's only jobs are: validate, adapt pipeline events to SSE frames, and tie
 * the client's connection to an AbortController. All orchestration lives in the pipeline.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
// Named import, not default: the package ships separate CJS/ESM type shapes and only the
// named `rateLimit` is callable under every module-resolution mode Vercel's build may pick.
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { logger } from "../core/logger.js";
import { SSEChannel } from "../http/sse.js";
import { runGeneration, type PipelineEvent } from "../pipeline/generate.pipeline.js";
import { generateRequestSchema } from "../schemas/generate.schema.js";
import { couponsConfigured, isValidCoupon } from "../services/coupons.js";
import {
  afterResponse,
  persistGeneration,
  persistGenerationEnabled,
} from "../services/persist-generation.js";

const config = env();

/**
 * This endpoint spends third-party API quota on every call and has no authentication,
 * so anyone who can reach it can burn Groq / Vercel credits. The limiter is a speed
 * bump, not access control — a public deployment needs real auth in front of it.
 */
const generateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "rate_limited",
      message: "Too many generations. Please wait a moment and try again.",
    },
  },
});

export const generateRouter = Router();

generateRouter.post("/generate", generateLimiter, async (req: Request, res: Response) => {
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    // Not streaming yet, so a normal HTTP error is still available to us.
    res.status(400).json({
      error: {
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid request.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return;
  }

  const request = parsed.data;

  // Advanced mode spends AI Gateway credits on a frontier model, so it needs a coupon.
  // Checked here rather than in the schema so the client gets a 403 about the coupon
  // instead of a 400 about a field, and before any provider call is made.
  if (request.mode === "advanced" && !isValidCoupon(request.coupon)) {
    res.status(403).json({
      error: {
        code: couponsConfigured ? "invalid_coupon" : "coupons_unavailable",
        message: couponsConfigured
          ? "Advanced mode needs a valid coupon code."
          : "Advanced mode is not available right now.",
      },
    });
    return;
  }

  const log = logger.child({
    route: "generate",
    reqId: randomUUID().slice(0, 8),
    mode: request.mode,
    promptChars: request.prompt.length,
  });
  log.info({ prompt: request.prompt }, "generation requested");

  const controller = new AbortController();
  const channel = new SSEChannel(res);

  // Client hung up (navigated away, pressed Stop) — cancel upstream work rather than
  // leaving a paid request running with nobody to receive it.
  const onClose = () => {
    if (!controller.signal.aborted) {
      controller.abort();
      log.info("client disconnected, generation aborted");
    }
    channel.close();
  };
  res.on("close", onClose);

  try {
    for await (const event of runGeneration(request, controller.signal)) {
      if (channel.isClosed) break;

      switch (event.type) {
        case "stage":
          log.info({ stage: event.stage }, `stage: ${event.stage}`);
          channel.send("stage", { stage: event.stage });
          break;
        case "enhanced":
          // The rewritten prompt is the single most useful thing in the log: it is what
          // the image model actually receives, and prompt quality is what we tune.
          log.info(
            { textModel: event.model, enhanced: event.enhanced, prompt: event.prompt },
            event.enhanced
              ? "prompt enhanced"
              : "prompt not enhanced, using it as written"
          );
          channel.send("enhanced", {
            prompt: event.prompt,
            model: event.model,
            enhanced: event.enhanced,
          });
          break;
        case "warning":
          log.warn({ code: event.code, detail: event.detail }, event.message);
          channel.send("warning", { code: event.code, message: event.message });
          break;
        case "done":
          log.info(
            {
              seed: event.seed,
              durationMs: event.durationMs,
              textModel: event.textModel,
              imageModel: event.imageModel,
              enhanced: event.enhanced,
              size: `${event.width}x${event.height}`,
              imageUrl: event.imageUrl,
              // The provider URL stays server-side; logging it is how we can still
              // reach the original asset when debugging a bad or missing image.
              upstreamUrl: event.upstreamUrl,
            },
            "generation complete"
          );
          channel.send("done", clientDone(event));
          // Deliberately after the send: the row and the permanent copy are bookkeeping,
          // and the user already has their image.
          if (persistGenerationEnabled) {
            afterResponse(persistGeneration(event, req.ip ?? null));
          }
          break;
        case "error":
          log.error({ code: event.code, detail: event.detail }, event.message);
          channel.send("error", { code: event.code, message: event.message });
          break;
      }
    }
  } catch (err) {
    log.error({ err }, "unhandled pipeline failure");
    channel.send("error", {
      code: "internal_error",
      message: "Something went wrong while generating the image.",
    });
  } finally {
    res.off("close", onClose);
    channel.close();
  }
});

/**
 * The client-facing shape of `done`: everything except the discriminant and the provider's
 * own image URL, which stays server-side so the browser only ever sees /api/images/:id.
 */
function clientDone(
  event: Extract<PipelineEvent, { type: "done" }>
): Record<string, unknown> {
  const { type: _type, upstreamUrl: _upstreamUrl, ...rest } = event;
  return rest;
}
