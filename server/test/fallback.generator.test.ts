import assert from "node:assert/strict";
import { test } from "node:test";
import { UpstreamError } from "../src/core/errors.ts";
import type {
  GenerateImageInput,
  GeneratedImage,
  ImageGenerator,
} from "../src/core/ports.ts";
import { FallbackImageGenerator } from "../src/providers/image/fallback.generator.ts";

/** A generator that either succeeds or throws, recording whether it was called. */
function stub(
  id: string,
  model: string,
  behaviour: { fail?: Error; image?: Partial<GeneratedImage> } = {}
): ImageGenerator & { calls: number } {
  return {
    id,
    model,
    calls: 0,
    async generate(this: { calls: number }, _input: GenerateImageInput) {
      this.calls++;
      if (behaviour.fail) throw behaviour.fail;
      return {
        upstreamUrl: `https://${id}.test/image.png`,
        seed: 7,
        ...behaviour.image,
      };
    },
  } as ImageGenerator & { calls: number };
}

const input: GenerateImageInput = {
  prompt: "p",
  width: 1024,
  height: 1024,
  steps: 9,
  signal: new AbortController().signal,
};

test("uses the primary and never touches the fallback when it succeeds", async () => {
  const primary = stub("primary", "Z-Image-Turbo");
  const fallback = stub("fallback", "pollinations/zimage");

  const result = await new FallbackImageGenerator({
    id: "image:default",
    chain: [primary, fallback],
  }).generate(input);

  assert.equal(primary.calls, 1);
  assert.equal(fallback.calls, 0);
  assert.equal(result.model, "Z-Image-Turbo");
  assert.equal(result.warning, undefined);
});

test("falls back on failure and explains why in a warning", async () => {
  const primary = stub("primary", "Z-Image-Turbo", {
    fail: new UpstreamError("Z-Image-Turbo: You have exceeded your ZeroGPU quota."),
  });
  const fallback = stub("fallback", "pollinations/zimage");

  const result = await new FallbackImageGenerator({
    id: "image:default",
    chain: [primary, fallback],
  }).generate(input);

  assert.equal(fallback.calls, 1);
  assert.equal(result.upstreamUrl, "https://fallback.test/image.png");
  assert.equal(result.model, "pollinations/zimage");
  assert.match(result.warning ?? "", /ZeroGPU quota/);
  assert.match(result.warning ?? "", /pollinations\/zimage/);
});

test("advertises the primary's model regardless of which one runs", () => {
  const chain = new FallbackImageGenerator({
    id: "image:default",
    chain: [stub("primary", "Z-Image-Turbo"), stub("fallback", "pollinations/zimage")],
  });
  assert.equal(chain.model, "Z-Image-Turbo");
});

test("when every provider fails, the primary's error is what surfaces", async () => {
  const primaryError = new UpstreamError("primary exploded");
  const primary = stub("primary", "A", { fail: primaryError });
  const fallback = stub("fallback", "B", { fail: new UpstreamError("fallback exploded") });

  await assert.rejects(
    new FallbackImageGenerator({ id: "image:default", chain: [primary, fallback] }).generate(
      input
    ),
    /fallback exploded/
  );
  assert.equal(fallback.calls, 1);
});

test("a cancelled request stops the chain instead of spending fallback quota", async () => {
  const controller = new AbortController();
  const primary: ImageGenerator & { calls: number } = {
    id: "primary",
    model: "A",
    calls: 0,
    async generate() {
      this.calls++;
      controller.abort(); // client disconnects mid-generation
      throw new DOMException("Aborted", "AbortError");
    },
  } as ImageGenerator & { calls: number };
  const fallback = stub("fallback", "B");

  await assert.rejects(
    new FallbackImageGenerator({ id: "image:default", chain: [primary, fallback] }).generate({
      ...input,
      signal: controller.signal,
    })
  );
  assert.equal(fallback.calls, 0);
});

test("a warning from the provider itself is not overwritten", async () => {
  const primary = stub("primary", "A", { fail: new UpstreamError("down") });
  const fallback = stub("fallback", "B", {
    image: { warning: "provider-specific note" },
  });

  const result = await new FallbackImageGenerator({
    id: "image:default",
    chain: [primary, fallback],
  }).generate(input);

  assert.equal(result.warning, "provider-specific note");
});

test("a single-entry chain behaves like the generator it wraps", async () => {
  const only = stub("only", "A");
  const result = await new FallbackImageGenerator({
    id: "image:default",
    chain: [only],
  }).generate(input);
  assert.equal(only.calls, 1);
  assert.equal(result.warning, undefined);
});

test("an empty chain is a construction error, not a runtime surprise", () => {
  assert.throws(
    () => new FallbackImageGenerator({ id: "image:default", chain: [] }),
    /at least one generator/
  );
});
