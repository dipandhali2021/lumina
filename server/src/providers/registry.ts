/**
 * Provider registry — the entire surface for adding or swapping a model.
 *
 * Register a factory under an id here, then point a mode profile at that id in
 * config/modes.ts. Instances are created lazily and memoized, so an unused provider
 * costs nothing and a shared one isn't rebuilt per request.
 */
import { env } from "../config/env.js";
import { MODE_PROFILES } from "../config/modes.js";
import { ConfigError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import type { ImageGenerator, TextEnhancer } from "../core/ports.js";
import { FallbackImageGenerator } from "./image/fallback.generator.js";
import { GradioImageGenerator } from "./image/gradio.generator.js";
import { PollinationsImageGenerator } from "./image/pollinations.generator.js";
import { OpenAICompatibleEnhancer } from "./text/openai-compatible.enhancer.js";

type Factory<T> = () => T;

const enhancerFactories = new Map<string, Factory<TextEnhancer>>();
const generatorFactories = new Map<string, Factory<ImageGenerator>>();
const enhancerCache = new Map<string, TextEnhancer>();
const generatorCache = new Map<string, ImageGenerator>();

export function registerEnhancer(id: string, factory: Factory<TextEnhancer>): void {
  enhancerFactories.set(id, factory);
}

export function registerGenerator(id: string, factory: Factory<ImageGenerator>): void {
  generatorFactories.set(id, factory);
}

export function resolveEnhancer(id: string): TextEnhancer {
  const cached = enhancerCache.get(id);
  if (cached) return cached;
  const factory = enhancerFactories.get(id);
  if (!factory) {
    throw new ConfigError(
      `Unknown text enhancer "${id}". Registered: ${[...enhancerFactories.keys()].join(", ") || "(none)"}.`
    );
  }
  const instance = factory();
  enhancerCache.set(id, instance);
  return instance;
}

export function resolveGenerator(id: string): ImageGenerator {
  const cached = generatorCache.get(id);
  if (cached) return cached;
  const factory = generatorFactories.get(id);
  if (!factory) {
    throw new ConfigError(
      `Unknown image generator "${id}". Registered: ${[...generatorFactories.keys()].join(", ") || "(none)"}.`
    );
  }
  const instance = factory();
  generatorCache.set(id, instance);
  return instance;
}

/** Wire the built-in providers. Called once at boot. */
export function registerBuiltInProviders(): void {
  const config = env();

  registerEnhancer(
    "groq:qwen3",
    () =>
      new OpenAICompatibleEnhancer({
        id: "groq:qwen3",
        label: "Groq",
        baseUrl: config.GROQ_BASE_URL,
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_TEXT_MODEL,
        temperature: 0.6,
        maxTokens: 1024,
        timeoutMs: config.ENHANCE_TIMEOUT_MS,
        // "none" rather than "default": with reasoning on, qwen spends most of the token
        // budget in a <think> block and the actual prompt gets clipped mid-sentence.
        reasoningEffort: "none",
      })
  );

  registerEnhancer(
    "vercel:grok",
    () =>
      new OpenAICompatibleEnhancer({
        id: "vercel:grok",
        label: "Vercel AI Gateway",
        baseUrl: config.AI_GATEWAY_BASE_URL,
        apiKey: config.AI_GATEWAY_API_KEY,
        model: config.ADVANCED_TEXT_MODEL,
        temperature: 0.85,
        maxTokens: 2048,
        timeoutMs: config.ENHANCE_TIMEOUT_MS,
        // grok reasons before answering; left unbounded it spends over a minute on a
        // rewrite. "none" keeps the richer cinematic template without the latency.
        reasoningEffort: "none",
      })
  );

  registerGenerator(
    "gradio:z-image-turbo",
    () =>
      new GradioImageGenerator({
        id: "gradio:z-image-turbo",
        label: "Z-Image-Turbo",
        model: "Z-Image-Turbo",
        baseUrl: config.ZIMAGE_BASE_URL,
        apiName: config.ZIMAGE_API_NAME,
        timeoutMs: config.IMAGE_TIMEOUT_MS,
        hfToken: config.HF_TOKEN,
        relayUrl: config.RELAY_URL,
      })
  );

  registerGenerator(
    "pollinations:zimage",
    () =>
      new PollinationsImageGenerator({
        id: "pollinations:zimage",
        label: "Pollinations",
        // The same Z-Image model the Gradio space serves, so switching keeps the look.
        model: `pollinations/${config.POLLINATIONS_IMAGE_MODEL}`,
        baseUrl: config.POLLINATIONS_BASE_URL,
        imageModel: config.POLLINATIONS_IMAGE_MODEL,
        apiKey: config.POLLINATIONS_API_KEY,
        timeoutMs: config.IMAGE_TIMEOUT_MS,
      })
  );

  /**
   * What the modes actually point at: Pollinations first, the Gradio space as backup.
   * Pollinations is authenticated per key and does not share a per-IP quota, so it is the
   * reliable one; the space is free but ZeroGPU-metered and fails under any load.
   *
   * Without POLLINATIONS_API_KEY there is nothing to put first, so this resolves to the
   * Gradio generator alone rather than a chain whose primary always throws.
   */
  registerGenerator("image:default", () => {
    const backup = resolveGenerator("gradio:z-image-turbo");
    if (!config.POLLINATIONS_API_KEY) {
      logger.warn(
        "POLLINATIONS_API_KEY not set — falling back to the ZeroGPU-metered Gradio space as the only image provider"
      );
      return backup;
    }
    return new FallbackImageGenerator({
      id: "image:default",
      chain: [backup, resolveGenerator("pollinations:zimage")],
    });
  });
}

/**
 * Fail fast: every provider id referenced by a mode profile must resolve. Called at
 * boot so a typo in the profile table is a startup error, not a 500 mid-request.
 */
export function assertProvidersResolvable(): Array<{
  mode: string;
  textModel: string;
  imageModel: string;
}> {
  return Object.entries(MODE_PROFILES).map(([mode, profile]) => ({
    mode,
    textModel: resolveEnhancer(profile.enhancerId).model,
    imageModel: resolveGenerator(profile.generatorId).model,
  }));
}
