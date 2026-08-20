/**
 * Generation pipeline: enhance the prompt with a text model, then render it with an
 * image model. Knows nothing about Express or about any specific vendor — it resolves
 * ports through the registry and yields transport-agnostic events, so the same
 * orchestration could be exposed over SSE, WebSockets, or a queue worker.
 */
import {
  ASPECT_DIMENSIONS,
  QUALITY_STEPS,
  modeProfile,
  type Mode,
} from "../config/modes.js";
import { toAppError, type ErrorCode } from "../core/errors.js";
import type { ImageGenerator, TextEnhancer } from "../core/ports.js";
import { resolveEnhancer, resolveGenerator } from "../providers/registry.js";
import type { GenerateRequest, ResolvedJob } from "../schemas/generate.schema.js";
import { putImageRef, type ImageRefFetch } from "../services/image-ref.store.js";
import { systemPromptFor } from "./prompt-templates.js";

export type Stage = "enhancing" | "generating";

export type PipelineEvent =
  | { type: "stage"; stage: Stage }
  | { type: "enhanced"; prompt: string; model: string; enhanced: boolean }
  /** `detail` is for logs only — the route forwards code and message, never detail. */
  | { type: "warning"; code: string; message: string; detail?: string }
  | {
      type: "done";
      imageUrl: string;
      seed: number;
      width: number;
      height: number;
      mode: Mode;
      aspectRatio: string;
      quality: string;
      prompt: string;
      originalPrompt: string;
      textModel: string;
      imageModel: string;
      enhanced: boolean;
      durationMs: number;
      /**
       * The provider's own image URL. Log-only: the route deliberately does not forward it,
       * since keeping provider hosts out of the browser is the point of the proxy.
       */
      upstreamUrl: string;
    }
  /** `detail` is for logs only — never forwarded to the client. */
  | { type: "error"; code: ErrorCode; message: string; detail?: string };

/** Overridable dependencies — real providers in production, fakes in tests. */
export interface PipelineDeps {
  resolveEnhancer: (id: string) => TextEnhancer;
  resolveGenerator: (id: string) => ImageGenerator;
  putImageRef: (url: string, how?: ImageRefFetch) => string;
}

const defaultDeps: PipelineDeps = {
  resolveEnhancer,
  resolveGenerator,
  putImageRef,
};

/** Apply mode defaults and map the friendly options onto provider parameters. */
export function resolveJob(request: GenerateRequest): ResolvedJob {
  const profile = modeProfile(request.mode);
  const aspectRatio = request.aspectRatio ?? profile.defaultAspectRatio;
  const quality = request.quality ?? profile.defaultQuality;
  const { width, height } = ASPECT_DIMENSIONS[aspectRatio];

  return {
    prompt: request.prompt,
    mode: request.mode,
    aspectRatio,
    quality,
    width,
    height,
    steps: QUALITY_STEPS[quality],
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
  };
}

export async function* runGeneration(
  request: GenerateRequest,
  signal: AbortSignal,
  deps: PipelineDeps = defaultDeps
): AsyncGenerator<PipelineEvent> {
  const startedAt = Date.now();
  const job = resolveJob(request);
  const profile = modeProfile(job.mode);

  try {
    // Resolve both providers up front: a config error should surface before we spend
    // a text-model call on a job whose image model doesn't exist.
    const enhancer = deps.resolveEnhancer(profile.enhancerId);
    const generator = deps.resolveGenerator(profile.generatorId);

    // --- Stage 1: enhance -------------------------------------------------------
    yield { type: "stage", stage: "enhancing" };

    let finalPrompt = job.prompt;
    let enhanced = false;

    try {
      const rewritten = await enhancer.enhance({
        prompt: job.prompt,
        systemPrompt: systemPromptFor(profile.enhanceStyle),
        signal,
      });
      if (rewritten) {
        finalPrompt = rewritten;
        enhanced = true;
      }
    } catch (err) {
      // A cancelled request is not a degradation — stop entirely.
      if (signal.aborted) throw err;
      const appError = toAppError(err);
      // Degrade gracefully: the rewrite is an enhancement, not a prerequisite.
      // Losing it should not cost the user their image.
      yield {
        type: "warning",
        code: "enhance_failed",
        message: `Prompt enhancement unavailable (${appError.message}) — using your prompt as written.`,
        ...(appError.details !== undefined
          ? { detail: String(appError.details).slice(0, 500) }
          : {}),
      };
    }

    yield {
      type: "enhanced",
      prompt: finalPrompt,
      model: enhancer.model,
      enhanced,
    };

    if (signal.aborted) return;

    // --- Stage 2: generate ------------------------------------------------------
    yield { type: "stage", stage: "generating" };

    const image = await generator.generate({
      prompt: finalPrompt,
      width: job.width,
      height: job.height,
      steps: job.steps,
      ...(job.seed !== undefined ? { seed: job.seed } : {}),
      signal,
    });

    // A fallback provider took over. Tell the user before `done`, so the note is attached
    // to the image rather than arriving after it.
    if (image.warning) {
      yield { type: "warning", code: "image_fallback", message: image.warning };
    }

    const imageId = deps.putImageRef(image.upstreamUrl, {
      ...(image.fetchHeaders ? { fetchHeaders: image.fetchHeaders } : {}),
      ...(image.fetchRelayUrl ? { fetchRelayUrl: image.fetchRelayUrl } : {}),
    });

    yield {
      type: "done",
      imageUrl: `/api/images/${imageId}`,
      seed: image.seed,
      width: job.width,
      height: job.height,
      mode: job.mode,
      aspectRatio: job.aspectRatio,
      quality: job.quality,
      prompt: finalPrompt,
      originalPrompt: job.prompt,
      textModel: enhancer.model,
      // The generator that actually rendered it, which is not the advertised model when
      // a fallback stepped in.
      imageModel: image.model ?? generator.model,
      enhanced,
      durationMs: Date.now() - startedAt,
      upstreamUrl: image.upstreamUrl,
    };
  } catch (err) {
    // The client is gone; there is nobody to tell.
    if (signal.aborted) return;
    const appError = toAppError(err);
    yield {
      type: "error",
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined
        ? { detail: String(appError.details).slice(0, 500) }
        : {}),
    };
  }
}
