import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitize } from "../src/providers/text/openai-compatible.enhancer.ts";

test("strips reasoning tags", () => {
  assert.equal(
    sanitize("<think>let me consider the lighting</think>a red barn at dusk"),
    "a red barn at dusk"
  );
});

test("discards a truncated reasoning block rather than shipping scratch work", () => {
  // Happens when the model burns its whole token budget thinking: no </think> arrives.
  assert.equal(sanitize("<think>Step 1: deconstruct the idea. Step 2:"), "");
  assert.equal(sanitize("a red barn\n<think>wait, let me reconsider"), "a red barn");
});

test("unwraps code fences", () => {
  assert.equal(sanitize("```\na red barn at dusk\n```"), "a red barn at dusk");
  assert.equal(sanitize("```text\na red barn\n```"), "a red barn");
});

test("drops a leading label and surrounding quotes", () => {
  assert.equal(sanitize("Enhanced prompt: a red barn"), "a red barn");
  assert.equal(sanitize('Prompt: "a red barn"'), "a red barn");
  assert.equal(sanitize("“a red barn”"), "a red barn");
});

test("collapses the result into a single paragraph", () => {
  assert.equal(
    sanitize("a red barn,\n\ngolden light,   wide shot"),
    "a red barn, golden light, wide shot"
  );
});

test("clips an overlong prompt at a comma boundary", () => {
  const long = Array.from({ length: 400 }, (_, i) => `detail ${i}`).join(", ");
  const result = sanitize(long);
  assert.ok(result.length <= 1200, `length ${result.length}`);
  assert.ok(!result.endsWith(","));
  // Clipped mid-list, not mid-word.
  assert.match(result, /detail \d+$/);
});

test("leaves an already-clean prompt untouched", () => {
  const clean = "a lighthouse in a storm, dramatic backlighting, oil painting";
  assert.equal(sanitize(clean), clean);
});
