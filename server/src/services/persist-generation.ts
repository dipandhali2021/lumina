/**
 * Post-response persistence: record the generation, then copy its image to permanent
 * storage and point the row at it.
 *
 * This runs *after* `done` has been written to the client, so nothing here is on the
 * user's critical path. That ordering is the whole design: a slow database or a slow
 * upload must not delay an image the user is already waiting on.
 *
 * On Vercel a function can be frozen the moment the response ends, so the work is
 * registered with `waitUntil`. Locally there is no such lifecycle and the promise simply
 * runs on the event loop.
 */
import { waitUntil } from "@vercel/functions";
import { logger } from "../core/logger.js";
import type { PipelineEvent } from "../pipeline/generate.pipeline.js";
import { getImageRef } from "../services/image-ref.store.js";
import { attachImage, persistenceEnabled, recordGeneration } from "./generations.store.js";
import { uploadGeneratedImage, uploadsEnabled } from "./image-upload.js";

type DoneEvent = Extract<PipelineEvent, { type: "done" }>;

/** Nothing to do at all when neither the database nor the uploader is configured. */
export const persistGenerationEnabled = persistenceEnabled || uploadsEnabled;

/**
 * Hand a promise to the platform so it survives the response. `waitUntil` throws when no
 * request context is available (plain `node`/`tsx`, tests), which is fine — the promise is
 * already running, and locally the process stays alive on its own.
 */
export function afterResponse(work: Promise<unknown>): void {
  const guarded = work.catch((err: unknown) => {
    logger.error({ err }, "background work failed");
  });
  try {
    waitUntil(guarded);
  } catch {
    // Not running on Vercel. The promise runs to completion on the event loop.
  }
}

/**
 * Write the row, upload the image, then fill in where it landed.
 *
 * The row is inserted first and updated afterwards rather than waiting for the upload,
 * so a failed or disabled upload still leaves the prompts — the reason the table exists
 * — recorded, with the image columns simply empty.
 */
export async function persistGeneration(
  event: DoneEvent,
  clientIp: string | null
): Promise<void> {
  const id = await recordGeneration({
    originalPrompt: event.originalPrompt,
    enhancedPrompt: event.prompt,
    enhanced: event.enhanced,
    clientIp,
    mode: event.mode,
    aspectRatio: event.aspectRatio,
    quality: event.quality,
    width: event.width,
    height: event.height,
    seed: event.seed,
    textModel: event.textModel,
    imageModel: event.imageModel,
    durationMs: event.durationMs,
  });

  if (!uploadsEnabled) return;

  // The headers and relay needed to fetch the bytes are held against the image id, not on
  // the event, so recover them the same way the /api/images proxy does.
  const ref = getImageRef(imageIdFrom(event.imageUrl));

  const uploaded = await uploadGeneratedImage(
    {
      url: event.upstreamUrl,
      ...(ref?.fetchHeaders ? { fetchHeaders: ref.fetchHeaders } : {}),
      ...(ref?.fetchRelayUrl ? { fetchRelayUrl: ref.fetchRelayUrl } : {}),
    },
    `generation-${event.seed}`
  );

  if (uploaded && id !== null) await attachImage(id, uploaded);
}

/** `/api/images/img_abc` -> `img_abc`. */
function imageIdFrom(imageUrl: string): string {
  return imageUrl.slice(imageUrl.lastIndexOf("/") + 1);
}
