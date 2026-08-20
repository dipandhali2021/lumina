/**
 * Mode profiles — the model switch.
 *
 * A "mode" is a named bundle of (text model, image model, parameter defaults).
 * Adding a mode or repointing one at a different model is an edit to this table plus
 * a registry entry; no route, pipeline, or provider code changes.
 */

export const MODES = ["normal", "advanced"] as const;
export type Mode = (typeof MODES)[number];

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

/** Enhancement voice, resolved to a system prompt in pipeline/prompt-templates.ts. */
export type EnhanceStyle = "concise" | "cinematic";

export interface ModeProfile {
  readonly enhancerId: string;
  readonly generatorId: string;
  readonly enhanceStyle: EnhanceStyle;
  readonly defaultAspectRatio: AspectRatio;
  readonly defaultQuality: Quality;
}

export const MODE_PROFILES: Record<Mode, ModeProfile> = {
  normal: {
    enhancerId: "groq:qwen3",
    generatorId: "image:default",
    enhanceStyle: "concise",
    defaultAspectRatio: "1:1",
    defaultQuality: "standard",
  },
  advanced: {
    enhancerId: "vercel:grok",
    generatorId: "image:default",
    enhanceStyle: "cinematic",
    defaultAspectRatio: "1:1",
    defaultQuality: "high",
  },
};

/** Pixel dimensions per aspect ratio. The Gradio space accepts 512–2048 per side. */
export const ASPECT_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "4:3": { width: 1152, height: 896 },
};

/** Inference steps per quality tier. The space accepts 1–20. */
export const QUALITY_STEPS: Record<Quality, number> = {
  draft: 4,
  standard: 9,
  high: 16,
};

export function modeProfile(mode: Mode): ModeProfile {
  return MODE_PROFILES[mode];
}
