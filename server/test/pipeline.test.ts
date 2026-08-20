import assert from "node:assert/strict";
import { test } from "node:test";
import { MODE_PROFILES } from "../src/config/modes.ts";
import { UpstreamError } from "../src/core/errors.ts";
import type { ImageGenerator, TextEnhancer } from "../src/core/ports.ts";
import {
  resolveJob,
  runGeneration,
  type PipelineDeps,
  type PipelineEvent,
} from "../src/pipeline/generate.pipeline.ts";
import type { GenerateRequest } from "../src/schemas/generate.schema.ts";

interface Recorded {
  enhancerIds: string[];
  generatorIds: string[];
  systemPrompts: string[];
  generateArgs: Array<{ prompt: string; width: number; height: number; steps: number; seed?: number }>;
}

function fakeDeps(options: {
  enhance?: (prompt: string) => Promise<string>;
  generate?: () => Promise<{ upstreamUrl: string; seed: number }>;
} = {}): { deps: PipelineDeps; recorded: Recorded } {
  const recorded: Recorded = {
    enhancerIds: [],
    generatorIds: [],
    systemPrompts: [],
    generateArgs: [],
  };

  const deps: PipelineDeps = {
    resolveEnhancer: (id) => {
      recorded.enhancerIds.push(id);
      const enhancer: TextEnhancer = {
        id,
        model: `model-for-${id}`,
        async enhance({ prompt, systemPrompt }) {
          recorded.systemPrompts.push(systemPrompt);
          return options.enhance
            ? options.enhance(prompt)
            : `enhanced(${prompt})`;
        },
      };
      return enhancer;
    },
    resolveGenerator: (id) => {
      recorded.generatorIds.push(id);
      const generator: ImageGenerator = {
        id,
        model: `image-model-for-${id}`,
        async generate(input) {
          recorded.generateArgs.push({
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            steps: input.steps,
            ...(input.seed !== undefined ? { seed: input.seed } : {}),
          });
          return options.generate
            ? options.generate()
            : { upstreamUrl: "https://upstream.test/out.webp", seed: 8412 };
        },
      };
      return generator;
    },
    putImageRef: () => "img_TEST",
  };

  return { deps, recorded };
}

async function collect(
  request: GenerateRequest,
  deps: PipelineDeps,
  signal = new AbortController().signal
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = [];
  for await (const event of runGeneration(request, signal, deps)) events.push(event);
  return events;
}

const baseRequest: GenerateRequest = { prompt: "a lighthouse", mode: "normal" };

test("normal mode emits the full stage sequence in order", async () => {
  const { deps } = fakeDeps();
  const events = await collect(baseRequest, deps);

  assert.deepEqual(
    events.map((e) => e.type),
    ["stage", "enhanced", "stage", "done"]
  );
  assert.equal((events[0] as { stage: string }).stage, "enhancing");
  assert.equal((events[2] as { stage: string }).stage, "generating");

  const done = events[3] as Extract<PipelineEvent, { type: "done" }>;
  assert.equal(done.imageUrl, "/api/images/img_TEST");
  assert.equal(done.seed, 8412);
  assert.equal(done.prompt, "enhanced(a lighthouse)");
  assert.equal(done.originalPrompt, "a lighthouse");
  assert.equal(done.enhanced, true);
  // Carried for the log line only; the route strips it before the wire.
  assert.equal(done.upstreamUrl, "https://upstream.test/out.webp");
});

test("mode selects the provider pair from the profile table", async () => {
  const normal = fakeDeps();
  await collect(baseRequest, normal.deps);
  assert.deepEqual(normal.recorded.enhancerIds, [MODE_PROFILES.normal.enhancerId]);

  const advanced = fakeDeps();
  await collect({ ...baseRequest, mode: "advanced" }, advanced.deps);
  assert.deepEqual(advanced.recorded.enhancerIds, [MODE_PROFILES.advanced.enhancerId]);

  // The switch must actually change the text model, which is the point of the design.
  assert.notEqual(
    normal.recorded.enhancerIds[0],
    advanced.recorded.enhancerIds[0]
  );
  // Both modes share the image backend today; that is config, not a code path.
  assert.deepEqual(normal.recorded.generatorIds, advanced.recorded.generatorIds);
});

test("each mode uses its own enhancement style", async () => {
  const normal = fakeDeps();
  await collect(baseRequest, normal.deps);
  const advanced = fakeDeps();
  await collect({ ...baseRequest, mode: "advanced" }, advanced.deps);

  const normalPrompt = normal.recorded.systemPrompts[0] ?? "";
  const advancedPrompt = advanced.recorded.systemPrompts[0] ?? "";

  assert.notEqual(normalPrompt, advancedPrompt);
  // Each model gets a template written for it: terse and literal vs. a layered brief.
  assert.match(normalPrompt, /40 to 70 words/);
  assert.match(advancedPrompt, /90 to\s+150 words/);
  assert.match(advancedPrompt, /camera/);
  assert.doesNotMatch(normalPrompt, /depth of field/);
  // Both still carry the constraints that protect the image stage.
  for (const prompt of [normalPrompt, advancedPrompt]) {
    assert.match(prompt, /Output ONLY the final image prompt/);
  }
});

test("reports the resolved text model on the enhanced event", async () => {
  const { deps } = fakeDeps();
  const events = await collect({ ...baseRequest, mode: "advanced" }, deps);
  const enhanced = events.find((e) => e.type === "enhanced") as Extract<
    PipelineEvent,
    { type: "enhanced" }
  >;
  assert.equal(enhanced.model, `model-for-${MODE_PROFILES.advanced.enhancerId}`);
});

test("a failing enhancer degrades to the raw prompt instead of failing the job", async () => {
  const { deps, recorded } = fakeDeps({
    enhance: async () => {
      throw new UpstreamError(
        "Vercel AI Gateway: Free tier requests on this model are rate-limited.",
        '{"error":{"type":"rate_limit_exceeded"}}'
      );
    },
  });
  const events = await collect(baseRequest, deps);

  assert.deepEqual(
    events.map((e) => e.type),
    ["stage", "warning", "enhanced", "stage", "done"]
  );
  const warning = events[1] as Extract<PipelineEvent, { type: "warning" }>;
  assert.equal(warning.code, "enhance_failed");
  // The provider's own reason reaches the user, so "why did I get my raw prompt back?"
  // is answerable without reading server logs.
  assert.match(warning.message, /Free tier requests on this model are rate-limited/);
  // The upstream body rides along for the log line but is not part of the message.
  assert.match(warning.detail ?? "", /rate_limit_exceeded/);
  assert.doesNotMatch(warning.message, /rate_limit_exceeded/);

  const done = events.at(-1) as Extract<PipelineEvent, { type: "done" }>;
  assert.equal(done.enhanced, false);
  assert.equal(done.prompt, "a lighthouse");
  assert.equal(recorded.generateArgs[0]!.prompt, "a lighthouse");
});

test("a failing generator produces a terminal error event", async () => {
  const { deps } = fakeDeps({
    generate: async () => {
      throw new UpstreamError("Z-Image-Turbo returned 429 (rate limited).");
    },
  });
  const events = await collect(baseRequest, deps);

  const last = events.at(-1) as Extract<PipelineEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.equal(last.code, "upstream_error");
  assert.match(last.message, /429/);
  assert.equal(events.some((e) => e.type === "done"), false);
});

test("an already-aborted request yields nothing", async () => {
  const { deps } = fakeDeps();
  const controller = new AbortController();
  controller.abort();
  const events = await collect(baseRequest, deps, controller.signal);
  // The stage event may race the abort check, but no result is ever emitted.
  assert.equal(events.some((e) => e.type === "done" || e.type === "error"), false);
});

test("aspect ratio and quality map to provider parameters", () => {
  const landscape = resolveJob({ prompt: "x", mode: "normal", aspectRatio: "16:9", quality: "draft" });
  assert.deepEqual(
    { w: landscape.width, h: landscape.height, steps: landscape.steps },
    { w: 1344, h: 768, steps: 4 }
  );

  const portrait = resolveJob({ prompt: "x", mode: "normal", aspectRatio: "9:16", quality: "high" });
  assert.deepEqual(
    { w: portrait.width, h: portrait.height, steps: portrait.steps },
    { w: 768, h: 1344, steps: 16 }
  );

  // Every dimension must stay inside the space's documented 512-2048 / 1-20 ranges.
  for (const ratio of ["1:1", "16:9", "9:16", "4:3"] as const) {
    for (const quality of ["draft", "standard", "high"] as const) {
      const job = resolveJob({ prompt: "x", mode: "normal", aspectRatio: ratio, quality });
      assert.ok(job.width >= 512 && job.width <= 2048, `width ${job.width}`);
      assert.ok(job.height >= 512 && job.height <= 2048, `height ${job.height}`);
      assert.ok(job.steps >= 1 && job.steps <= 20, `steps ${job.steps}`);
    }
  }
});

test("omitted options fall back to the mode's defaults", () => {
  const normal = resolveJob({ prompt: "x", mode: "normal" });
  assert.equal(normal.quality, MODE_PROFILES.normal.defaultQuality);
  const advanced = resolveJob({ prompt: "x", mode: "advanced" });
  assert.equal(advanced.quality, MODE_PROFILES.advanced.defaultQuality);
  assert.notEqual(normal.quality, advanced.quality);
});

test("an explicit seed is forwarded; an omitted seed is left to the provider", async () => {
  const withSeed = fakeDeps();
  await collect({ ...baseRequest, seed: 1234 }, withSeed.deps);
  assert.equal(withSeed.recorded.generateArgs[0]!.seed, 1234);

  const withoutSeed = fakeDeps();
  await collect(baseRequest, withoutSeed.deps);
  assert.equal("seed" in withoutSeed.recorded.generateArgs[0]!, false);
});
