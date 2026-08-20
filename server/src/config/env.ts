/**
 * Typed, validated view of process.env.
 *
 * Nothing else in the server reads process.env directly — providers receive their
 * configuration through the registry, so swapping a model never means hunting for
 * env lookups scattered across modules.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Minimal .env loader — avoids a dependency for a handful of KEY=value lines.
 * Exported so scripts can read .env without triggering full schema validation.
 */
export function loadDotEnv(): void {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue; // real env always wins
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

const intFrom = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

/**
 * A required block of prompt text that lives on a single .env line: "\n" escapes become
 * real newlines, so a multi-line rules block survives the line-based loader above. No
 * code-side default — a missing or blank value is a startup failure, so the prompt can
 * never quietly go out without its rules.
 */
const promptBlock = (message: string) =>
  z
    .string({ required_error: message })
    .transform((v) => v.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t").trim())
    .refine((v) => v.length > 0, message);

const envSchema = z.object({
  PORT: intFrom(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  CORS_ORIGIN: csv("http://localhost:5173"),

  RATE_LIMIT_WINDOW_MS: intFrom(60_000),
  RATE_LIMIT_MAX: intFrom(10),

  GROQ_API_KEY: z.string().min(1, "required for normal-mode prompt enhancement"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_TEXT_MODEL: z.string().min(1).default("qwen/qwen3.6-27b"),

  AI_GATEWAY_API_KEY: z
    .string()
    .min(1, "required for advanced-mode prompt enhancement"),
  AI_GATEWAY_BASE_URL: z.string().url().default("https://ai-gateway.vercel.sh/v1"),
  ADVANCED_TEXT_MODEL: z.string().min(1).default("xai/grok-4.6"),

  ZIMAGE_BASE_URL: z
    .string()
    .url()
    .default("https://mrfakename-z-image-turbo.hf.space"),
  ZIMAGE_API_NAME: z.string().min(1).default("generate_image"),
  ZIMAGE_ALLOWED_HOSTS: csv(
    "mrfakename-z-image-turbo.hf.space,gen.pollinations.ai"
  ),
  // Optional. The space runs on ZeroGPU, which grants anonymous callers a small shared
  // quota per IP; a token raises it. Without one, expect "quota exceeded" under any load.
  HF_TOKEN: z.string().default(""),

  // Vercel relay for the image space only. Empty (the default) dials the space directly.
  // Both Gradio hops travel via the relay, moving the ZeroGPU per-IP quota to the relay's
  // address. A trailing slash is fine; the URL is used verbatim as the request target.
  RELAY_URL: z.union([z.string().url(), z.literal("")]).default(""),

  // Pollinations image fallback, used when the Gradio space fails (ZeroGPU quota, most
  // often). Never relayed — it authenticates per key, so a shared IP buys nothing.
  // Empty disables the fallback: the Gradio space becomes the only image backend.
  POLLINATIONS_API_KEY: z.string().default(""),
  POLLINATIONS_BASE_URL: z.string().url().default("https://gen.pollinations.ai"),
  POLLINATIONS_IMAGE_MODEL: z.string().min(1).default("zimage"),

  ENHANCE_TIMEOUT_MS: intFrom(45_000),
  IMAGE_TIMEOUT_MS: intFrom(180_000),

  // Lakebase Postgres (Neon) connection string, used to record one row per generation.
  // Empty disables persistence entirely: generation still works, nothing is written.
  DATABASE_URL: z.union([z.string().url(), z.literal("")]).default(""),

  // UploadThing token, for copying each generated image to permanent storage. Empty
  // disables the upload; images are then only reachable while the provider keeps them.
  UPLOADTHING_TOKEN: z.string().default(""),

  // Coupon codes that unlock advanced ("Think") mode, comma-separated. Advanced mode
  // spends AI Gateway credits on a frontier model, so it is gated. An empty list locks
  // advanced mode entirely rather than opening it to everyone — see services/coupons.ts.
  ADVANCED_COUPONS: csv(""),

  // Content-policy rules appended to the enhancement system prompt, for both modes.
  // Written as one line; "\n" sequences become real newlines. Required — the server
  // refuses to boot without it rather than enhancing prompts with no policy attached.
  PROMPT_EXTRA_RULES: promptBlock(
    "required — content-policy rules for the enhancement prompt"
  ),
});   

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and freeze the environment. Called once at boot so a misconfiguration is a
 * startup failure with a readable list of problems, not a 500 on the first request.
 */
export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new Error(
      `Invalid server environment. Copy server/.env.example to server/.env and fill it in.\n${lines.join("\n")}`
    );
  }
  cached = Object.freeze(parsed.data);
  return cached;
}

/** Convenience accessor for modules constructed after boot. */
export function env(): Env {
  return loadEnv();
}
