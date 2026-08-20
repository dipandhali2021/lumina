/**
 * Gradio-backed image generator (Z-Image-Turbo and any space with the same signature).
 *
 * Gradio's REST bridge is two hops:
 *   1. POST /gradio_api/call/v2/<api_name>  -> { event_id }
 *   2. GET  /gradio_api/call/<api_name>/<event_id> -> SSE, terminating in `complete`
 */
import { UpstreamError } from "../../core/errors.js";
import type {
  GenerateImageInput,
  GeneratedImage,
  ImageGenerator,
} from "../../core/ports.js";
import { parseSSEStream } from "../../http/sse.js";
import { pointsAtRelay } from "../../http/relay.js";
import { upstreamFetch, upstreamJson } from "../../http/upstream.js";

export interface GradioGeneratorConfig {
  readonly id: string;
  readonly model: string;
  readonly baseUrl: string;
  /** Gradio api_name, e.g. "generate_image". */
  readonly apiName: string;
  readonly timeoutMs: number;
  readonly label: string;
  /** Optional HF token; raises the ZeroGPU quota this space allots per caller. */
  readonly hfToken?: string;
  /**
   * Send both hops via this Vercel relay. Empty or absent means dial the space directly.
   * The space meters ZeroGPU per caller IP, so relaying moves that quota to the relay.
   */
  readonly relayUrl?: string;
}

interface ImageData {
  path?: string | null;
  url?: string | null;
}

export class GradioImageGenerator implements ImageGenerator {
  readonly id: string;
  readonly model: string;
  private readonly base: string;

  constructor(private readonly config: GradioGeneratorConfig) {
    this.id = config.id;
    this.model = config.model;
    this.base = config.baseUrl.replace(/\/$/, "");
  }

  /** Auth header when a token is configured; anonymous (small quota) otherwise. */
  private authHeaders(): Record<string, string> {
    return this.config.hfToken
      ? { Authorization: `Bearer ${this.config.hfToken}` }
      : {};
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    const eventId = await this.submit(input);
    return this.awaitResult(eventId, input.signal);
  }

  /** Hop 1: enqueue the job. */
  private async submit(input: GenerateImageInput): Promise<string> {
    const randomize = input.seed === undefined;
    const json = await upstreamJson<{ event_id?: string }>({
      url: `${this.base}/gradio_api/call/v2/${this.config.apiName}`,
      method: "POST",
      headers: this.authHeaders(),
      body: {
        prompt: input.prompt,
        height: input.height,
        width: input.width,
        num_inference_steps: input.steps,
        seed: input.seed ?? 0,
        randomize_seed: randomize,
      },
      // The queue accepts quickly even when generation itself is slow.
      timeoutMs: Math.min(30_000, this.config.timeoutMs),
      signal: input.signal,
      retries: 2,
      label: this.config.label,
      relayUrl: this.config.relayUrl,
    });

    if (!json.event_id) {
      throw new UpstreamError(
        `${this.config.label} did not return an event id.`,
        JSON.stringify(json).slice(0, 300)
      );
    }
    return json.event_id;
  }

  /** Hop 2: read the result stream until `complete` or `error`. */
  private async awaitResult(
    eventId: string,
    signal: AbortSignal
  ): Promise<GeneratedImage> {
    const response = await upstreamFetch({
      url: `${this.base}/gradio_api/call/${this.config.apiName}/${eventId}`,
      headers: { Accept: "text/event-stream", ...this.authHeaders() },
      timeoutMs: this.config.timeoutMs,
      signal,
      // The job is already queued; retrying would fetch the same stream, not restart it.
      retries: 0,
      label: this.config.label,
      relayUrl: this.config.relayUrl,
    });

    if (!response.body) {
      throw new UpstreamError(`${this.config.label} returned an empty result stream.`);
    }

    for await (const message of parseSSEStream(response.body)) {
      if (message.event === "heartbeat" || message.event === "generating") continue;

      if (message.event === "error") {
        throw new UpstreamError(
          `${this.config.label}: ${describeError(message.data)}`,
          message.data.slice(0, 300)
        );
      }

      if (message.event === "complete") {
        return this.parseComplete(message.data);
      }
    }

    throw new UpstreamError(
      `${this.config.label} closed the stream before finishing.`
    );
  }

  private parseComplete(data: string): GeneratedImage {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new UpstreamError(
        `${this.config.label} returned an unreadable result.`,
        data.slice(0, 300)
      );
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      throw new UpstreamError(
        `${this.config.label} returned an unexpected result shape.`,
        data.slice(0, 300)
      );
    }

    const image = payload[0] as ImageData | null;
    const seedRaw = payload[1];

    const upstreamUrl = this.resolveUrl(image);
    if (!upstreamUrl) {
      throw new UpstreamError(
        `${this.config.label} returned no image URL.`,
        data.slice(0, 300)
      );
    }

    const seed = typeof seedRaw === "number" ? Math.trunc(seedRaw) : 0;
    return {
      upstreamUrl,
      seed,
      // The space keeps generated files on the local disk of whichever replica rendered
      // them, and its router picks a replica by caller IP. Generating via the relay means
      // only the relay's IP reaches that replica — a direct fetch of the same URL lands on
      // a different one, which does not have the file and answers "File not allowed".
      ...(this.config.relayUrl?.trim()
        ? { fetchRelayUrl: this.config.relayUrl.trim() }
        : {}),
    };
  }

  /**
   * Prefer the absolute URL; fall back to the `file=` bridge for a bare path.
   *
   * One wrinkle when relaying: this relay rewrites absolute URLs in the response body to
   * point at itself, so `url` comes back as `https://<relay>/gradio_api/file=...`. That
   * URL is a dead end — fetching it without the relay headers is a 400, and it isn't in
   * the image proxy's host allowlist. Detect it and rebuild the real URL from `path`,
   * which the relay leaves alone.
   */
  private resolveUrl(image: ImageData | null): string | null {
    if (!image) return null;
    if (image.url && !pointsAtRelay(image.url, this.config.relayUrl)) return image.url;
    if (image.path) {
      return `${this.base}/gradio_api/file=${image.path}`;
    }
    // A relay-rewritten url with no path to rebuild from would only fail later, in the
    // image proxy, as an opaque 403. Fail here where the cause is visible.
    return null;
  }
}

/**
 * Gradio's `error` frame carries the reason the space rejected the job — most often a
 * ZeroGPU quota limit on this shared public space. Surfacing it beats a generic failure,
 * since the user's next step ("wait" vs "retry") depends on which it was.
 */
function describeError(data: string): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim().slice(0, 300);
    if (parsed && typeof parsed === "object") {
      const { error, title } = parsed as { error?: unknown; title?: unknown };
      if (typeof error === "string" && error.trim()) return error.trim().slice(0, 300);
      if (typeof title === "string" && title.trim()) return title.trim().slice(0, 300);
    }
  } catch {
    const plain = data.trim();
    if (plain && plain !== "null") return plain.slice(0, 300);
  }
  return "failed to generate the image.";
}
