import assert from "node:assert/strict";
import { test } from "node:test";
import { describeUpstreamReason } from "../src/http/upstream.ts";

test("surfaces an OpenAI-style nested error message", () => {
  // The shape both Groq and the Vercel AI Gateway use.
  const body = JSON.stringify({
    error: {
      message:
        "Free tier requests on this model are rate-limited. Upgrade to paid credits for unrestricted access.",
      type: "rate_limit_exceeded",
    },
  });
  assert.match(describeUpstreamReason(body), /^Free tier requests on this model/);
});

test("accepts a bare message or a string body", () => {
  assert.equal(
    describeUpstreamReason(JSON.stringify({ message: "model not found" })),
    "model not found"
  );
  assert.equal(describeUpstreamReason(JSON.stringify("service unavailable")), "service unavailable");
  assert.equal(describeUpstreamReason(JSON.stringify({ error: "bad key" })), "bad key");
});

test("passes plain text through but ignores HTML error pages", () => {
  assert.equal(describeUpstreamReason("upstream connect error"), "upstream connect error");
  assert.equal(describeUpstreamReason("<html><body>502 Bad Gateway</body></html>"), "");
});

test("returns nothing when the body carries no usable reason", () => {
  // The caller falls back to the status code, so "" must mean "no reason", not "unknown".
  assert.equal(describeUpstreamReason(""), "");
  assert.equal(describeUpstreamReason("   "), "");
  assert.equal(describeUpstreamReason(JSON.stringify({ error: { type: "overloaded" } })), "");
  assert.equal(describeUpstreamReason(JSON.stringify({ detail: "nope" })), "");
});

test("clips a long reason to a UI-sized string", () => {
  const reason = describeUpstreamReason(JSON.stringify({ error: { message: "x".repeat(1000) } }));
  assert.ok(reason.length <= 240, `length ${reason.length}`);
});
