/**
 * Pollinations image generator — https://gen.pollinations.ai
 *
 * One GET returns the image bytes directly:
 *   GET /image/<url-encoded prompt>?model=zimage&width=&height=&seed=&nologo=true
 *
 * Unlike the Gradio provider there is no queue and no result stream, so a single
 * request either produces an image or fails. The response body IS the image, which the
 * `GeneratedImage` contract can't carry — so we hand back the request URL plus the auth
 * header the image proxy needs to fetch it. The credential travels in `fetchHeaders`
 * rather than a query param, keeping it out of the stored URL and out of logs.
 */
import { ConfigError, UpstreamError } from "../../core/errors.js";
import type {
  GenerateImageInput,
  GeneratedImage,
  ImageGenerator,
} from "../../core/ports.js";
import { upstreamFetch } from "../../http/upstream.js";

export interface PollinationsGeneratorConfig {
  readonly id: string;
  readonly model: string;
  readonly label: string;
  readonly baseUrl: string;
  /** Pollinations model id, e.g. "zimage". */
  readonly imageModel: string;
  /** Secret key (`sk_`). Required — every generation request is authenticated. */
  readonly apiKey: string;
  readonly timeoutMs: number;
}

/** Pollinations rejects seeds outside the 32-bit unsigned range. */
const MAX_SEED = 2_147_483_647;

export class PollinationsImageGenerator implements ImageGenerator {
  readonly id: string;
  readonly model: string;
  private readonly base: string;

  constructor(private readonly config: PollinationsGeneratorConfig) {
    this.id = config.id;
    this.model = config.model;
    this.base = config.baseUrl.replace(/\/$/, "");
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    if (!this.config.apiKey) {
      throw new ConfigError(
        `${this.config.label} needs POLLINATIONS_API_KEY (https://enter.pollinations.ai/keys).`
      );
    }

    // No seed means "randomize", which this API expresses as simply omitting the param.
    // Pick one ourselves so the response can report the seed that was actually used.
    const seed =
      input.seed !== undefined
        ? Math.abs(Math.trunc(input.seed)) % (MAX_SEED + 1)
        : Math.floor(Math.random() * (MAX_SEED + 1));

    const url = this.buildUrl(input, seed);
    const headers = { Authorization: `Bearer ${this.config.apiKey}` };

    // Verify the URL actually renders before handing it on: a failure surfaces here as a
    // readable error, whereas a broken URL passed downstream becomes an opaque 502 from
    // the image proxy. The API caches by URL, so this generation is billed once and the
    // proxy's later fetch is served from cache.
    const response = await upstreamFetch({
      url,
      headers: { ...headers, Accept: "image/*" },
      timeoutMs: this.config.timeoutMs,
      signal: input.signal,
      // Generation is billed, and the API explicitly supports an identical retry
      // resolving to the in-flight or cached result, so a retry cannot double-charge.
      retries: 1,
      label: this.config.label,
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new UpstreamError(
        `${this.config.label} did not return an image.`,
        `content-type: ${contentType || "(none)"}`
      );
    }

    // The bytes are re-fetched by the image proxy from cache; nothing needs them here.
    await response.body?.cancel();

    return { upstreamUrl: url, seed, model: this.model, fetchHeaders: headers };
  }

  private buildUrl(input: GenerateImageInput, seed: number): string {
    const params = new URLSearchParams({
      model: this.config.imageModel,
      width: String(input.width),
      height: String(input.height),
      seed: String(seed),
      nologo: "true",
    });
    // encodeURIComponent, not URLSearchParams: the prompt is a path segment here, and a
    // literal "/" or "?" in it would otherwise change which endpoint is addressed.
    return `${this.base}/image/${encodeURIComponent(input.prompt)}?${params}`;
  }
}
