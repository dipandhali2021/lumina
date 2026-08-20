import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { UpstreamError } from "../src/core/errors.ts";
import { PollinationsImageGenerator } from "../src/providers/image/pollinations.generator.ts";

const BASE = "https://gen.pollinations.test";

function generator(overrides: { apiKey?: string } = {}) {
  return new PollinationsImageGenerator({
    id: "pollinations:zimage",
    label: "Pollinations",
    model: "pollinations/zimage",
    baseUrl: BASE,
    imageModel: "zimage",
    apiKey: overrides.apiKey ?? "sk_test_key",
    timeoutMs: 5_000,
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(
  options: { contentType?: string; status?: number } = {}
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response("fake-image-bytes", {
      status: options.status ?? 200,
      headers: { "Content-Type": options.contentType ?? "image/jpeg" },
    });
  }) as typeof fetch;
  return calls;
}

const input = {
  prompt: "a lighthouse at dusk",
  width: 1344,
  height: 768,
  steps: 9,
  signal: new AbortController().signal,
};

test("builds a /image/{prompt} url carrying model and dimensions", async () => {
  const calls = stubFetch();
  const result = await generator().generate({ ...input, seed: 42 });

  const url = new URL(calls[0]!.url);
  assert.equal(url.origin, BASE);
  assert.equal(url.pathname, "/image/a%20lighthouse%20at%20dusk");
  assert.equal(url.searchParams.get("model"), "zimage");
  assert.equal(url.searchParams.get("width"), "1344");
  assert.equal(url.searchParams.get("height"), "768");
  assert.equal(url.searchParams.get("seed"), "42");
  assert.equal(url.searchParams.get("nologo"), "true");
  assert.equal(result.upstreamUrl, calls[0]!.url);
  assert.equal(result.seed, 42);
  assert.equal(result.model, "pollinations/zimage");
});

test("the key travels in a header, never in the url", async () => {
  const calls = stubFetch();
  const result = await generator({ apiKey: "sk_secret" }).generate(input);

  assert.equal(calls[0]!.headers.Authorization, "Bearer sk_secret");
  assert.ok(!calls[0]!.url.includes("sk_secret"));
  // The proxy needs the same header later; the URL alone must not be enough to leak it.
  assert.equal(result.fetchHeaders?.Authorization, "Bearer sk_secret");
  assert.ok(!result.upstreamUrl.includes("sk_secret"));
});

test("a prompt with url metacharacters stays inside the path segment", async () => {
  const calls = stubFetch();
  await generator().generate({ ...input, prompt: "a/b?c=d&e #f" });

  const url = new URL(calls[0]!.url);
  // Encoded, so it cannot address a different endpoint or inject query params.
  assert.equal(url.pathname, "/image/a%2Fb%3Fc%3Dd%26e%20%23f");
  assert.equal(url.searchParams.get("model"), "zimage");
  assert.equal(url.searchParams.get("c"), null);
});

test("an omitted seed is chosen locally and reported back", async () => {
  const calls = stubFetch();
  const result = await generator().generate(input);

  const sent = new URL(calls[0]!.url).searchParams.get("seed");
  assert.equal(sent, String(result.seed));
  assert.ok(Number.isInteger(result.seed));
  assert.ok(result.seed >= 0 && result.seed <= 2_147_483_647);
});

test("an out-of-range seed is clamped into the accepted range", async () => {
  const calls = stubFetch();
  const result = await generator().generate({ ...input, seed: 9_999_999_999 });
  const sent = Number(new URL(calls[0]!.url).searchParams.get("seed"));
  assert.ok(sent >= 0 && sent <= 2_147_483_647);
  assert.equal(sent, result.seed);
});

test("a non-image response is an error, not a broken image url", async () => {
  stubFetch({ contentType: "application/json" });
  await assert.rejects(
    generator().generate(input),
    (err: unknown) =>
      err instanceof UpstreamError && /did not return an image/i.test(err.message)
  );
});

test("a missing api key fails as a config error before any request", async () => {
  const calls = stubFetch();
  await assert.rejects(
    generator({ apiKey: "" }).generate(input),
    /POLLINATIONS_API_KEY/
  );
  assert.equal(calls.length, 0);
});
