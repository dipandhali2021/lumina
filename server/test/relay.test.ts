import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRelay,
  pointsAtRelay,
  RELAY_PATH_HEADER,
  RELAY_TARGET_HEADER,
} from "../src/http/relay.ts";

const RELAY = "https://relay.example.app/";
const SPACE = "https://space.hf.space";

test("splits a target into origin and path headers, pointing the request at the relay", () => {
  const { url, headers } = applyRelay(
    `${SPACE}/gradio_api/call/v2/generate_image`,
    {},
    RELAY
  );
  assert.equal(url, RELAY);
  assert.equal(headers[RELAY_TARGET_HEADER], SPACE);
  assert.equal(headers[RELAY_PATH_HEADER], "/gradio_api/call/v2/generate_image");
});

test("keeps the query string with the path, where the relay expects it", () => {
  const { headers } = applyRelay(`${SPACE}/api?a=1&b=two`, {}, RELAY);
  assert.equal(headers[RELAY_TARGET_HEADER], SPACE);
  assert.equal(headers[RELAY_PATH_HEADER], "/api?a=1&b=two");
});

test("a bare origin relays as path /", () => {
  const { headers } = applyRelay(SPACE, {}, RELAY);
  assert.equal(headers[RELAY_PATH_HEADER], "/");
});

test("a non-default port stays with the origin, not the path", () => {
  const { headers } = applyRelay("http://localhost:7860/gradio_api/x", {}, RELAY);
  assert.equal(headers[RELAY_TARGET_HEADER], "http://localhost:7860");
  assert.equal(headers[RELAY_PATH_HEADER], "/gradio_api/x");
});

test("caller headers are preserved — auth must survive the rewrite", () => {
  const { headers } = applyRelay(
    `${SPACE}/x`,
    { Authorization: "Bearer hf_token", Accept: "text/event-stream" },
    RELAY
  );
  assert.equal(headers.Authorization, "Bearer hf_token");
  assert.equal(headers.Accept, "text/event-stream");
  assert.equal(headers[RELAY_TARGET_HEADER], SPACE);
});

test("no relay url means the request is returned untouched", () => {
  const original = { Accept: "application/json" };
  for (const empty of [undefined, "", "   "]) {
    const { url, headers } = applyRelay(`${SPACE}/x`, original, empty);
    assert.equal(url, `${SPACE}/x`);
    assert.deepEqual(headers, original);
    assert.ok(!(RELAY_TARGET_HEADER in headers));
  }
});

test("a malformed target throws rather than silently going direct", () => {
  assert.throws(() => applyRelay("not-a-url", {}, RELAY), /Cannot relay a malformed URL/);
});

test("pointsAtRelay recognises the relay's own host and nothing else", () => {
  assert.equal(pointsAtRelay(`${RELAY}gradio_api/file=/tmp/x.png`, RELAY), true);
  assert.equal(pointsAtRelay(`${SPACE}/gradio_api/file=/tmp/x.png`, RELAY), false);
  // Without a configured relay, nothing can point at it.
  assert.equal(pointsAtRelay(`${RELAY}x`, ""), false);
  // A malformed url is not a relay url; it must not throw here.
  assert.equal(pointsAtRelay("not-a-url", RELAY), false);
});
