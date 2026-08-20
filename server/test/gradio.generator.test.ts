import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GradioImageGenerator } from "../src/providers/image/gradio.generator.ts";

const BASE = "https://space.test";
const RELAY = "https://relay.test/";

function generator(relayUrl?: string) {
  return new GradioImageGenerator({
    id: "gradio:test",
    label: "Z-Image-Turbo",
    model: "Z-Image-Turbo",
    baseUrl: BASE,
    apiName: "generate_image",
    timeoutMs: 5_000,
    ...(relayUrl !== undefined ? { relayUrl } : {}),
  });
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub both hops: POST returns an event id, GET returns an SSE body. */
function stubFetch(sse: string, options: { eventId?: string | null } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    if (init?.method === "POST") {
      const eventId = options.eventId === undefined ? "evt_123" : options.eventId;
      return new Response(JSON.stringify(eventId === null ? {} : { event_id: eventId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
  return calls;
}

test("two-hop flow returns the absolute url and the seed used", async () => {
  const calls = stubFetch(
    "event: heartbeat\ndata: null\n\n" +
      `event: complete\ndata: [{"path":"/tmp/gradio/a/out.webp","url":"${BASE}/gradio_api/file=/tmp/gradio/a/out.webp"},8412]\n\n`
  );

  const result = await generator().generate({
    prompt: "a lighthouse",
    width: 1344,
    height: 768,
    steps: 9,
    seed: 42,
    signal: new AbortController().signal,
  });

  assert.equal(result.upstreamUrl, `${BASE}/gradio_api/file=/tmp/gradio/a/out.webp`);
  assert.equal(result.seed, 8412);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, `${BASE}/gradio_api/call/v2/generate_image`);
  assert.deepEqual(calls[0]!.body, {
    prompt: "a lighthouse",
    height: 768,
    width: 1344,
    num_inference_steps: 9,
    seed: 42,
    randomize_seed: false,
  });
  assert.equal(calls[1]!.url, `${BASE}/gradio_api/call/generate_image/evt_123`);
});

test("an omitted seed asks the space to randomize", async () => {
  const calls = stubFetch('event: complete\ndata: [{"url":"https://x/y.webp"},7]\n\n');
  await generator().generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 4,
    signal: new AbortController().signal,
  });
  assert.equal((calls[0]!.body as { randomize_seed: boolean }).randomize_seed, true);
});

test("falls back to the file= bridge when url is null", async () => {
  stubFetch('event: complete\ndata: [{"path":"/tmp/gradio/b/out.png","url":null},3]\n\n');
  const result = await generator().generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });
  assert.equal(result.upstreamUrl, `${BASE}/gradio_api/file=/tmp/gradio/b/out.png`);
});

test("an upstream error event becomes an UpstreamError carrying the reason", async () => {
  stubFetch('event: error\ndata: "GPU quota exceeded"\n\n');
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /GPU quota exceeded/i
  );
});

test("a structured error object surfaces its message, not a generic failure", async () => {
  stubFetch(
    'event: error\ndata: {"error":"You have exceeded your ZeroGPU quota","title":"ZeroGPU quota exceeded"}\n\n'
  );
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /exceeded your ZeroGPU quota/i
  );
});

test("an error event with no readable reason still fails clearly", async () => {
  stubFetch("event: error\ndata: null\n\n");
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /failed to generate/i
  );
});

test("a stream that ends without completing is an error, not a hang", async () => {
  stubFetch("event: generating\ndata: null\n\n");
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /closed the stream/i
  );
});

test("a missing event id is reported rather than silently retried", async () => {
  stubFetch("", { eventId: null });
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /event id/i
  );
});

test("a result with no usable image reference errors out", async () => {
  stubFetch('event: complete\ndata: [{"path":null,"url":null},1]\n\n');
  await assert.rejects(
    generator().generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /no image URL/i
  );
});

test("with a relay configured, both hops go to the relay carrying the real target", async () => {
  const calls = stubFetch(
    `event: complete\ndata: [{"path":"/tmp/gradio/a/out.png","url":"${BASE}/gradio_api/file=/tmp/gradio/a/out.png"},9]\n\n`
  );

  await generator(RELAY).generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, RELAY);
    assert.equal(call.headers["x-relay-target"], BASE);
  }
  assert.equal(calls[0]!.headers["x-relay-path"], "/gradio_api/call/v2/generate_image");
  assert.equal(calls[1]!.headers["x-relay-path"], "/gradio_api/call/generate_image/evt_123");
  // The submit body must still reach the space unchanged.
  assert.equal((calls[0]!.body as { prompt: string }).prompt, "p");
});

test("a relay-rewritten image url is rebuilt from path, not passed through", async () => {
  // The live relay rewrites absolute urls in bodies to point at itself. Such a url 400s
  // without relay headers and fails the image proxy allowlist, so it must not be used.
  stubFetch(
    'event: complete\ndata: [{"path":"/tmp/gradio/a/out.png","url":"https://relay.test/gradio_api/file=/tmp/gradio/a/out.png"},9]\n\n'
  );

  const result = await generator(RELAY).generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });

  assert.equal(result.upstreamUrl, `${BASE}/gradio_api/file=/tmp/gradio/a/out.png`);
});

test("a relay-rewritten url with no path to rebuild from fails loudly", async () => {
  stubFetch(
    'event: complete\ndata: [{"path":null,"url":"https://relay.test/gradio_api/file=/x.png"},9]\n\n'
  );
  await assert.rejects(
    generator(RELAY).generate({
      prompt: "p",
      width: 1024,
      height: 1024,
      steps: 9,
      signal: new AbortController().signal,
    }),
    /no image URL/i
  );
});

test("without a relay, an upstream url is used as-is even if it looks unusual", async () => {
  // Guards the relay check from firing when RELAY_URL is empty.
  stubFetch(
    'event: complete\ndata: [{"path":"/tmp/a.png","url":"https://relay.test/gradio_api/file=/tmp/a.png"},9]\n\n'
  );
  const result = await generator().generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });
  assert.equal(result.upstreamUrl, "https://relay.test/gradio_api/file=/tmp/a.png");
});

test("a relayed generation asks for its bytes to be fetched through the same relay", async () => {
  // The space runs multiple replicas and keeps generated files on local disk, so only the
  // replica that rendered the image can serve it. Replica routing follows the caller's IP,
  // so the byte fetch has to leave from the same egress the generation did.
  stubFetch(
    `event: complete\ndata: [{"path":"/tmp/gradio/a/out.png","url":"${BASE}/gradio_api/file=/tmp/gradio/a/out.png"},9]\n\n`
  );

  const result = await generator(RELAY).generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });

  assert.equal(result.upstreamUrl, `${BASE}/gradio_api/file=/tmp/gradio/a/out.png`);
  assert.equal(result.fetchRelayUrl, RELAY);
});

test("an unrelayed generation carries no fetch relay, so the proxy dials direct", async () => {
  stubFetch(
    `event: complete\ndata: [{"path":"/tmp/gradio/a/out.png","url":"${BASE}/gradio_api/file=/tmp/gradio/a/out.png"},9]\n\n`
  );
  const result = await generator().generate({
    prompt: "p",
    width: 1024,
    height: 1024,
    steps: 9,
    signal: new AbortController().signal,
  });
  assert.equal(result.fetchRelayUrl, undefined);
});
