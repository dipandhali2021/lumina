/**
 * Pollinations fallback smoke test: `npm run pollinations:test`.
 *
 * Verifies the fallback can actually render before you rely on it — and it will only be
 * exercised in production when the Gradio space is already failing, which is a bad moment
 * to discover the key is wrong.
 *
 * Checks, in order: the model is listed, a real generation returns image bytes, and the
 * proxy path works (the URL is re-fetchable with the auth header, as images.route.ts does).
 * A generation costs pollen, so this runs exactly one.
 */
import { loadDotEnv } from "../src/config/env.js";
import { PollinationsImageGenerator } from "../src/providers/image/pollinations.generator.js";

loadDotEnv();

const apiKey = (process.env.POLLINATIONS_API_KEY ?? "").trim();
const baseUrl = (process.env.POLLINATIONS_BASE_URL ?? "https://gen.pollinations.ai").trim();
const imageModel = (process.env.POLLINATIONS_IMAGE_MODEL ?? "zimage").trim();

const pass = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`    \x1b[2m${m}\x1b[0m`);

let failures = 0;

/** The model list needs no auth, so this separates "bad model" from "bad key". */
async function checkModelListed(): Promise<void> {
  console.log(`\n1. "${imageModel}" is a known image model`);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/image/models`, {
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json();
    const rows = Array.isArray(body)
      ? body
      : ((body as { data?: unknown[] }).data ?? []);
    const match = rows.find((row) => {
      if (typeof row === "string") return row === imageModel;
      const entry = row as { name?: string; id?: string; aliases?: string[] };
      return (
        entry.name === imageModel ||
        entry.id === imageModel ||
        entry.aliases?.includes(imageModel) === true
      );
    });

    if (match) {
      const title = (match as { title?: string }).title;
      pass(`listed${title ? ` — ${title}` : ""}`);
    } else {
      failures++;
      fail(`not in the catalog of ${rows.length} models`);
      info("check POLLINATIONS_IMAGE_MODEL against GET /image/models");
    }
  } catch (err) {
    failures++;
    fail(`could not list models: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Exercise the real generator class, then re-fetch its URL exactly as the image proxy
 * will. Testing the class rather than a hand-rolled request means a bug in URL building
 * or seed handling shows up here.
 */
async function checkGeneration(): Promise<void> {
  console.log("\n2. a real generation returns image bytes");
  if (!apiKey) {
    failures++;
    fail("POLLINATIONS_API_KEY is not set");
    info("get a key (sk_...) at https://enter.pollinations.ai/keys");
    return;
  }

  const generator = new PollinationsImageGenerator({
    id: "pollinations:zimage",
    label: "Pollinations",
    model: `pollinations/${imageModel}`,
    baseUrl,
    imageModel,
    apiKey,
    timeoutMs: 120_000,
  });

  const startedAt = Date.now();
  try {
    const image = await generator.generate({
      prompt: "a single orange traffic cone on wet asphalt, overcast",
      width: 1024,
      height: 1024,
      steps: 9, // ignored by this API; kept so the call matches the pipeline's shape
      signal: new AbortController().signal,
    });
    pass(`generated in ${Date.now() - startedAt}ms, seed ${image.seed}`);
    info(`model reported: ${image.model}`);

    console.log("\n3. the proxy can re-fetch it (what /api/images does)");
    const refetch = await fetch(image.upstreamUrl, {
      ...(image.fetchHeaders ? { headers: { ...image.fetchHeaders } } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const contentType = refetch.headers.get("content-type") ?? "";
    const bytes = (await refetch.arrayBuffer()).byteLength;

    if (refetch.ok && contentType.startsWith("image/") && bytes > 0) {
      pass(`${contentType}, ${(bytes / 1024).toFixed(0)}KB`);
    } else {
      failures++;
      fail(`re-fetch returned ${refetch.status}, content-type "${contentType}", ${bytes} bytes`);
    }

    // The proxy blocks any host not in the allowlist, so a mismatch here would surface
    // in production as an opaque 403 on the image, after a paid generation.
    const host = new URL(image.upstreamUrl).host;
    const allowed = (process.env.ZIMAGE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    console.log("\n4. the image host is allowlisted for the proxy");
    if (allowed.includes(host.toLowerCase())) {
      pass(`${host} is in ZIMAGE_ALLOWED_HOSTS`);
    } else {
      failures++;
      fail(`${host} is NOT in ZIMAGE_ALLOWED_HOSTS`);
      info(`add it, or /api/images will refuse to serve the fallback's images`);
    }
  } catch (err) {
    failures++;
    fail(`generation failed after ${Date.now() - startedAt}ms`);
    info(err instanceof Error ? err.message : String(err));
  }
}

async function main(): Promise<void> {
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Model:    ${imageModel}`);
  console.log(`Key:      ${apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : "(not set)"}`);

  await checkModelListed();
  await checkGeneration();

  if (failures > 0) {
    console.log(`\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
    process.exit(1);
  }
  console.log("\n\x1b[32mPollinations fallback is ready.\x1b[0m");
}

void main();
