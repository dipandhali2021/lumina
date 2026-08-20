import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFrame, parseSSEStream } from "../src/http/sse.ts";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: Array<{ event: string; data: string }> = [];
  for await (const message of parseSSEStream(stream)) out.push(message);
  return out;
}

test("formatFrame escapes newlines inside data", () => {
  const frame = formatFrame("enhanced", { prompt: "line one\nline two" });
  assert.equal(frame, 'event: enhanced\ndata: {"prompt":"line one\\nline two"}\n\n');
  // Exactly one data line, so a multi-line prompt can't be read as two frames.
  assert.equal(frame.split("\n").filter((l) => l.startsWith("data:")).length, 1);
});

test("parses discrete frames", async () => {
  const messages = await collect(
    streamOf('event: stage\ndata: {"stage":"enhancing"}\n\nevent: complete\ndata: [1,2]\n\n')
  );
  assert.deepEqual(messages, [
    { event: "stage", data: '{"stage":"enhancing"}' },
    { event: "complete", data: "[1,2]" },
  ]);
});

test("reassembles a frame split across chunk boundaries", async () => {
  const messages = await collect(
    streamOf("event: comp", 'lete\ndata: [{"url":"http', '://x/y.webp"},42]\n\n')
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.event, "complete");
  assert.deepEqual(JSON.parse(messages[0]!.data), [{ url: "http://x/y.webp" }, 42]);
});

test("joins multi-line data and skips comments and heartbeats", async () => {
  const messages = await collect(
    streamOf(": ping 1\n\nevent: msg\ndata: a\ndata: b\n\n")
  );
  assert.deepEqual(messages, [{ event: "msg", data: "a\nb" }]);
});

test("handles CRLF line endings and a trailing unterminated frame", async () => {
  const messages = await collect(
    streamOf("event: stage\r\ndata: x\r\n\r\nevent: complete\ndata: done")
  );
  assert.deepEqual(messages, [
    { event: "stage", data: "x" },
    { event: "complete", data: "done" },
  ]);
});
