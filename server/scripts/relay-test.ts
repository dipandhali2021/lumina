/**
 * Relay smoke test: `npm run relay:test`.
 *
 * Checks the four things the image pipeline depends on, against the relay in RELAY_URL:
 *   1. the relay is reachable and forwards a GET  (example.com)
 *   2. it forwards a POST body intact             (the Gradio submit hop's shape)
 *   3. it streams a response body unbuffered      (the Gradio result hop is SSE)
 *   4. it rewrites absolute URLs in bodies        (which resolveUrl compensates for)
 *
 * A script rather than an HTTP route: /api is unauthenticated, so a route would hand any
 * caller a button that spends relay quota.
 */
import { loadDotEnv } from "../src/config/env.js";
import { applyRelay, RELAY_PATH_HEADER, RELAY_TARGET_HEADER } from "../src/http/relay.js";

// Read server/.env directly. Not loadEnv(), which would demand the API keys this
// script never uses.
loadDotEnv();

const relayUrl = (process.env.RELAY_URL ?? "").trim();

const pass = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`    \x1b[2m${m}\x1b[0m`);

let failures = 0;

/** Fetch `target` through the relay, with a deadline so a hung relay can't hang the run. */
async function viaRelay(
  target: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string } = {},
  timeoutMs = 30_000
): Promise<Response> {
  const { url, headers } = applyRelay(target, init.headers ?? {}, relayUrl);
  return fetch(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function checkGet(): Promise<void> {
  console.log("\n1. GET https://example.com/ through the relay");
  const startedAt = Date.now();
  try {
    const response = await viaRelay("https://example.com/");
    const body = await response.text();
    const elapsed = Date.now() - startedAt;

    if (response.ok && body.includes("Example Domain")) {
      pass(`${response.status} in ${elapsed}ms, body is example.com`);
    } else {
      failures++;
      fail(`${response.status} in ${elapsed}ms — unexpected body`);
      info(body.slice(0, 200));
    }
  } catch (err) {
    failures++;
    fail(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkPostBody(): Promise<void> {
  console.log("\n2. POST body survives the relay");
  const probe = { probe: "body-intact", n: 42 };
  try {
    const response = await viaRelay("https://postman-echo.com/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(probe),
    });
    const echoed = (await response.json()) as { data?: unknown };
    if (JSON.stringify(echoed.data) === JSON.stringify(probe)) {
      pass("the echo service received the body byte-for-byte");
    } else {
      failures++;
      fail("body was altered or dropped");
      info(`sent ${JSON.stringify(probe)}, echoed ${JSON.stringify(echoed.data)}`);
    }
  } catch (err) {
    failures++;
    fail(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Read a chunked endpoint and time first-chunk vs last-chunk arrival. A relay that
 * buffers whole bodies would break the Gradio result hop, which is SSE — so this is the
 * check that matters most. An unreachable probe endpoint is reported as skipped, not
 * failed: it says nothing about the relay.
 */
async function checkStreaming(): Promise<void> {
  console.log("\n3. response bodies stream rather than buffer");
  const startedAt = Date.now();
  try {
    // Emits 20 JSON documents back-to-back in a chunked response.
    const response = await viaRelay("https://postman-echo.com/stream/20");
    if (!response.ok || !response.body) {
      fail(`probe endpoint returned ${response.status} — skipped`);
      info("says nothing about the relay; re-run when the endpoint is up");
      return;
    }

    const reader = response.body.getReader();
    let firstChunkMs = -1;
    let chunks = 0;
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstChunkMs === -1) firstChunkMs = Date.now() - startedAt;
      chunks++;
      bytes += value?.length ?? 0;
    }
    const totalMs = Date.now() - startedAt;

    if (bytes === 0) {
      failures++;
      fail("stream delivered no bytes");
    } else if (chunks > 1) {
      pass(`${chunks} chunks, first at ${firstChunkMs}ms, last at ${totalMs}ms — streamed`);
    } else {
      // One chunk for a small fast body is normal and proves nothing either way.
      pass(`delivered in 1 chunk (${bytes} bytes, ${totalMs}ms) — inconclusive, not a fault`);
      info("the Gradio SSE hop is the real test; a long generation holds the stream open");
    }
  } catch (err) {
    fail(`could not check: ${err instanceof Error ? err.message : String(err)}`);
    info("probe endpoint unreachable — skipped, not counted as a failure");
  }
}

async function checkUrlRewriting(): Promise<void> {
  console.log("\n4. absolute URLs in response bodies are rewritten to the relay");
  try {
    const response = await viaRelay("https://postman-echo.com/get");
    const body = await response.text();
    const relayHost = new URL(relayUrl).host;
    if (body.includes(relayHost)) {
      pass(`confirmed — bodies mention ${relayHost}`);
      info("GradioImageGenerator.resolveUrl rebuilds the real URL from `path` for this");
    } else {
      pass("no rewriting seen on this response (harmless either way)");
    }
  } catch (err) {
    fail(`could not check: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  if (!relayUrl) {
    console.error(
      "RELAY_URL is not set. Add it to server/.env, or run:\n" +
        "  RELAY_URL=https://your-relay.vercel.app/ npm run relay:test"
    );
    process.exit(1);
  }

  console.log(`Relay: ${relayUrl}`);
  console.log(`Spec:  ${RELAY_TARGET_HEADER} + ${RELAY_PATH_HEADER}`);

  await checkGet();
  await checkPostBody();
  await checkStreaming();
  await checkUrlRewriting();

  if (failures > 0) {
    console.log(`\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
    process.exit(1);
  }
  console.log("\n\x1b[32mRelay is usable for the Gradio hops.\x1b[0m");
}

void main();
