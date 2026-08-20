import { Router } from "express";
import { MODE_PROFILES, MODES } from "../config/modes.js";
import { resolveEnhancer, resolveGenerator } from "../providers/registry.js";
import { imageRefCount } from "../services/image-ref.store.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
});

/**
 * Which models each mode currently resolves to. Useful for verifying the switch
 * without spending a generation, and safe to expose: model names, never keys.
 */
healthRouter.get("/models", (_req, res) => {
  const modes = MODES.map((mode) => {
    const profile = MODE_PROFILES[mode];
    return {
      mode,
      text: {
        id: profile.enhancerId,
        model: resolveEnhancer(profile.enhancerId).model,
      },
      image: {
        id: profile.generatorId,
        model: resolveGenerator(profile.generatorId).model,
      },
      defaults: {
        aspectRatio: profile.defaultAspectRatio,
        quality: profile.defaultQuality,
      },
    };
  });
  res.json({ modes, cachedImages: imageRefCount() });
});
