/**
 * Generation options shared by the prompt bar and the API client.
 *
 * These literals mirror the server's zod schema (server/src/schemas/generate.schema.ts),
 * which remains the source of truth — this module is the display layer for them.
 */

export const MODES = ["normal", "advanced"] as const;
export type Mode = (typeof MODES)[number];

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

export interface GenerateOptions {
  mode: Mode;
  /**
   * Omitted lets the server apply the mode's default. Advanced mode deliberately sends
   * neither: its enhancement picks framing and detail itself.
   */
  aspectRatio?: AspectRatio;
  quality?: Quality;
  /** Coupon unlocking advanced mode. Required by the server whenever mode is "advanced". */
  coupon?: string;
}

export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  "1:1": "Square · 1:1",
  "16:9": "Landscape · 16:9",
  "9:16": "Portrait · 9:16",
  "4:3": "Classic · 4:3",
};

export const QUALITY_LABELS: Record<Quality, string> = {
  draft: "Draft · fastest",
  standard: "Standard",
  high: "High detail",
};

/** The mode defaults, mirroring the server's. `coupon` is not a default — it is earned. */
export const DEFAULT_OPTIONS: Required<Omit<GenerateOptions, "coupon">> = {
  mode: "normal",
  aspectRatio: "1:1",
  quality: "standard",
};

/** CSS aspect-ratio value, so the image placeholder reserves the right shape up front. */
export function aspectRatioCss(ratio: AspectRatio): string {
  return ratio.replace(":", " / ");
}

/**
 * The ratio as a number (width ÷ height). Used to derive a width from a viewport-height
 * budget, which is how the result image is kept on screen without scrolling.
 */
export function aspectRatioValue(ratio: AspectRatio): number {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}
