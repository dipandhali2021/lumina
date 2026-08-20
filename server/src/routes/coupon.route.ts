/**
 * POST /api/coupon — check a coupon code without generating anything.
 *
 * This exists so the UI can enable its Think toggle the moment a code is entered, instead
 * of letting the user pick advanced mode and discover at generation time that their code
 * is wrong. The real gate is still in the generate route: this endpoint is a convenience,
 * and a client that lies about holding a coupon gets a 403 there.
 *
 * Rate limited harder than generation, because unlike generation this is worth guessing at.
 */
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { logger } from "../core/logger.js";
import { couponsConfigured, isValidCoupon } from "../services/coupons.js";

const couponLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "rate_limited",
      message: "Too many attempts. Please wait a moment and try again.",
    },
  },
});

const bodySchema = z.object({ coupon: z.string().min(1).max(200) }).strict();

export const couponRouter = Router();

couponRouter.post("/coupon", couponLimiter, (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: "validation_error", message: "A coupon code is required." },
    });
    return;
  }

  if (!couponsConfigured) {
    res.status(503).json({
      error: {
        code: "coupons_unavailable",
        message: "Advanced mode is not available right now.",
      },
    });
    return;
  }

  const valid = isValidCoupon(parsed.data.coupon);
  // The code itself is never logged: it is a shared secret, and log destinations are not
  // where secrets should end up.
  logger.info({ ip: req.ip, valid }, "coupon checked");

  if (!valid) {
    res.status(403).json({
      error: { code: "invalid_coupon", message: "That code isn't valid." },
    });
    return;
  }

  res.json({ valid: true });
});
