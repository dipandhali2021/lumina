/**
 * Fallback image generator: try the primary, and on failure try the next one.
 *
 * Composes `ImageGenerator`s rather than adding fallback logic to the pipeline, so the
 * pipeline stays unaware that more than one image backend exists, and the chain can be
 * reordered or extended from the registry alone.
 */import { AppError, isAbortError } from "../../core/errors.js";
import { logger } from "../../core/logger.js";
import type {
  GenerateImageInput,
  GeneratedImage,
  ImageGenerator,
} from "../../core/ports.js";

export interface FallbackGeneratorConfig {
  readonly id: string;
  /** Tried in order. The first entry's model name is this generator's advertised model. */
  readonly chain: readonly ImageGenerator[];
}

export class FallbackImageGenerator implements ImageGenerator {
  readonly id: string;
  readonly model: string;
  private readonly chain: readonly ImageGenerator[];

  constructor(config: FallbackGeneratorConfig) {
    if (config.chain.length === 0) {
      throw new Error("FallbackImageGenerator needs at least one generator.");
    }
    this.id = config.id;
    this.chain = config.chain;
    // Advertise the primary's model. A result that came from a fallback reports its own
    // model via GeneratedImage.model, so the client is never told the wrong backend.
    this.model = config.chain[0]!.model;
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    const failures: string[] = [];

    for (const [index, generator] of this.chain.entries()) {
      const isLast = index === this.chain.length - 1;
      try {
        const image = await generator.generate(input);

        // Tell the user their image came from the backup, and why. Only meaningful for a
        // non-primary success, and only when a warning isn't already set.
        if (index > 0 && !image.warning) {
          return {
            ...image,
            model: image.model ?? generator.model,
            warning: `${failures[0]} Generated with ${generator.model} instead.`,
          };
        }
        return { ...image, model: image.model ?? generator.model };
      } catch (err) {
        // A cancelled request means the client left. Trying the next provider would spend
        // real quota on an image nobody will see.
        if (input.signal.aborted || isAbortError(err)) throw err;

        const message = err instanceof AppError ? err.message : String(err);
        failures.push(message);
        logger.warn(
          { generator: generator.id, attempt: index + 1, err },
          isLast ? "image generator failed; no fallback left" : "image generator failed; trying fallback"
        );

        // Nothing left to try — surface the primary's failure, which is the one that
        // explains what the user actually asked for.
        if (isLast) throw err;
      }
    }

    // Unreachable: the loop either returns or rethrows on the final entry.
    throw new Error("Fallback chain exhausted without a result.");
  }
}
