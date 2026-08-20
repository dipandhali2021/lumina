/**
 * Request schema. This is the source of truth for the API contract; the frontend's
 * option types mirror these literals.
 */
import { z } from "zod";
import {
  ASPECT_RATIOS,
  MODES,
  QUALITIES,
  type AspectRatio,
  type Mode,
  type Quality,
} from "../config/modes.js";

export const generateRequestSchema = z
  .object({
    prompt: z
      .string({ required_error: "prompt is required" })
      .trim()
      .min(1, "prompt cannot be empty")
      .max(2000, "prompt must be 2000 characters or fewer"),
    mode: z.enum(MODES).default("normal"),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    quality: z.enum(QUALITIES).optional(),
    /** Fixed seed for reproducible output; omitted means randomize. */
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    /**
     * Coupon code unlocking advanced mode. Required when `mode` is "advanced" and ignored
     * otherwise; the route checks it, not this schema, so the failure is a 403 about the
     * coupon rather than a validation error about a field.
     */
    coupon: z.string().max(200).optional(),
  })
  .strict();

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** Fully-resolved job after mode defaults are applied. */
export interface ResolvedJob {
  readonly prompt: string;
  readonly mode: Mode;
  readonly aspectRatio: AspectRatio;
  readonly quality: Quality;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly seed?: number;
}
