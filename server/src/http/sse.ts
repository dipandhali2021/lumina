/**
 * Server-sent events: writing frames to a client, and reading frames from an upstream
 * (the Gradio space also speaks SSE, so the parser is shared).
 */
import type { Response } from "express";

const HEARTBEAT_MS = 15_000;

/** Serialize one SSE frame. `data` is JSON, newline-escaped by JSON.stringify. */
export function formatFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SSEChannel {
  private closed = false;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx and friends not to buffer, which would defeat streaming.
      "X-Accel-Buffering": "no",
    });
    // Flush headers immediately so the client's reader starts before the first event.
    res.flushHeaders?.();
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  send(event: string, data: unknown): void {
    if (this.isClosed) return;
    this.res.write(formatFrame(event, data));
  }

  /** Comment frame — keeps idle intermediaries from closing the connection. */
  private ping(): void {
    if (this.isClosed) return;
    this.res.write(`: ping ${Date.now()}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (!this.res.writableEnded) this.res.end();
  }
}

export interface SSEMessage {
  event: string;
  data: string;
}

/**
 * Incrementally parse an SSE byte stream into messages.
 *
 * Frames are separated by a blank line; a frame may carry multiple `data:` lines,
 * which per spec are joined with "\n". Comment lines (`:`) are dropped.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SSEMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = indexOfFrameEnd(buffer)) !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^(\r?\n){2}/, "");
        const message = parseFrame(rawFrame);
        if (message) yield message;
      }
    }
    // Trailing frame with no terminating blank line.
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock?.();
  }
}

function indexOfFrameEnd(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function parseFrame(raw: string): SSEMessage | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0 && event === "message") return null;
  return { event, data: dataLines.join("\n") };
}
