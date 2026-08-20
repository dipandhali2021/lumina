/**
 * Copies a generated image to UploadThing, so it outlives the provider's own hosting.
 *
 * Provider URLs are temporary by design: the Gradio space serves files from the local
 * disk of whichever replica rendered them and drops them on restart, and Pollinations
 * URLs expire. Once a generation is in the database, the image it points at needs to
 * still be there — that is what this module is for.
 *
 * The upload is best-effort. It runs after the client already has its image, so a failure
 * costs a permanent copy, not the generation.
 */
import { UTApi, UTFile } from "uploadthing/server";
import { env } from "../config/env.js";
import { logger } from "../core/logger.js";
import { applyRelay } from "../http/relay.js";

const config = env();

/** Null when UPLOADTHING_TOKEN is empty — `uploadGeneratedImage` then returns null. */
const api = config.UPLOADTHING_TOKEN
  ? new UTApi({ token: config.UPLOADTHING_TOKEN })
  : null;

export const uploadsEnabled = api !== null;

const FETCH_TIMEOUT_MS = 60_000;

export interface UploadSource {
  /** Provider URL holding the bytes. */
  url: string;
  /** Headers required to fetch it — an API key for providers that need one. */
  fetchHeaders?: Readonly<Record<string, string>>;
  /**
   * Relay the fetch must travel through. Same reason as the image proxy: a host that
   * serves from replica-local disk only answers the egress that generated the file.
   */
  fetchRelayUrl?: string;
}

export interface UploadedImage {
  url: string;
  key: string;
}

/**
 * Fetch the image from the provider and upload it. Returns null when uploads are
 * disabled or anything along the way fails; the caller treats that as "no permanent
 * copy" and moves on.
 *
 * Note this is a fetch-then-upload rather than UTApi's `uploadFilesFromUrl`: the provider
 * URLs here need custom headers and sometimes a relay, and passing a bare URL to
 * UploadThing would drop both.
 */
export async function uploadGeneratedImage(
  source: UploadSource,
  name: string
): Promise<UploadedImage | null> {
  if (!api) return null;

  try {
    const { url, headers } = applyRelay(
      source.url,
      { ...(source.fetchHeaders ?? {}) },
      source.fetchRelayUrl
    );

    const response = await fetch(url, {
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, upstreamUrl: source.url },
        "could not fetch image for permanent upload"
      );
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "image/webp";
    if (!contentType.startsWith("image/")) {
      logger.warn({ contentType }, "upstream did not return an image to upload");
      return null;
    }

    const bytes = await response.arrayBuffer();
    // The content type rides on a Blob rather than UTFile's own options bag: UTFile's
    // property bag extends the DOM's BlobPropertyBag, which isn't in this project's libs
    // (server tsconfig is ES2023 + node), so `type` is not assignable there.
    const blob = new Blob([bytes], { type: contentType });
    const file = new UTFile([blob], `${name}.${extensionFor(contentType)}`);

    const result = await api.uploadFiles(file);
    if (result.error) {
      logger.error({ err: result.error }, "UploadThing upload failed");
      return null;
    }

    logger.info(
      { key: result.data.key, bytes: result.data.size },
      "image uploaded to permanent storage"
    );
    return { url: result.data.ufsUrl, key: result.data.key };
  } catch (err) {
    logger.error({ err, upstreamUrl: source.url }, "permanent image upload failed");
    return null;
  }
}

function extensionFor(contentType: string): string {
  const subtype = contentType.split(";")[0]?.split("/")[1] ?? "webp";
  return subtype === "jpeg" ? "jpg" : subtype;
}
