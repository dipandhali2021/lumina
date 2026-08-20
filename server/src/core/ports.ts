/**
 * Ports — the only contracts the pipeline depends on.
 *
 * Providers implement these; the pipeline consumes them. No vendor name appears on
 * either side of this boundary, which is what makes the mode switch a config change.
 */

export interface EnhanceInput {
  /** Raw prompt as typed by the user. */
  readonly prompt: string;
  /** System prompt selected by the mode's enhanceStyle. */
  readonly systemPrompt: string;
  readonly signal: AbortSignal;
}

export interface TextEnhancer {
  /** Registry id, e.g. "groq:qwen3". */
  readonly id: string;
  /** Concrete upstream model name, surfaced to the client for transparency. */
  readonly model: string;
  enhance(input: EnhanceInput): Promise<string>;
}

export interface GenerateImageInput {
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  /** Omitted means "let the provider randomize". */
  readonly seed?: number;
  readonly signal: AbortSignal;
}

export interface GeneratedImage {
  /** Absolute URL on the provider's host. Never handed to the browser directly. */
  readonly upstreamUrl: string;
  readonly seed: number;
  /**
   * Model that actually produced this image. Differs from `ImageGenerator.model` when a
   * composite generator fell back to a secondary provider, so the client is told which
   * backend really rendered the result.
   */
  readonly model?: string;
  /**
   * Headers required to fetch `upstreamUrl` — an API key, typically. Kept separate from
   * the URL so a credential never lands in a log line or a stored URL.
   */
  readonly fetchHeaders?: Readonly<Record<string, string>>;
  /**
   * Relay `upstreamUrl` must be fetched through, when the provider generated it behind
   * one. Hosts that serve generated files from local disk (a multi-replica Gradio space)
   * only hold the file on the replica that produced it, and replica routing is keyed on
   * caller IP — so fetching from a different egress than the one that generated it is a
   * 403. Carrying the relay here keeps the byte fetch on the same route.
   */
  readonly fetchRelayUrl?: string;
  /** Surfaced to the user as a warning, e.g. "the primary provider was unavailable". */
  readonly warning?: string;
}

export interface ImageGenerator {
  readonly id: string;
  readonly model: string;
  generate(input: GenerateImageInput): Promise<GeneratedImage>;
}
