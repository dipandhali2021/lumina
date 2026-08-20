/**
 * Client for POST /api/generate.
 *
 * EventSource can't issue a POST, so we read the SSE body off fetch ourselves with a
 * small incremental parser — the same framing the server writes.
 */
import type { AspectRatio, Mode, Quality } from "./generate-options";

export interface GenerateRequest {
  prompt: string;
  mode: Mode;
  /** Omitted means "use the mode's server-side default". */
  aspectRatio?: AspectRatio;
  quality?: Quality;
  seed?: number;
  /** Required by the server when mode is "advanced". */
  coupon?: string;
}

export type Stage = "enhancing" | "generating";

export interface EnhancedEvent {
  prompt: string;
  model: string;
  enhanced: boolean;
}

export interface DoneEvent {
  imageUrl: string;
  seed: number;
  width: number;
  height: number;
  mode: Mode;
  aspectRatio: AspectRatio;
  quality: Quality;
  prompt: string;
  originalPrompt: string;
  textModel: string;
  imageModel: string;
  enhanced: boolean;
  durationMs: number;
}

export interface StreamHandlers {
  onStage?: (stage: Stage) => void;
  onEnhanced?: (event: EnhancedEvent) => void;
  onWarning?: (message: string) => void;
  onDone?: (event: DoneEvent) => void;
  onError?: (message: string) => void;
}

/**
 * Mirror the pipeline to the browser console, so a bad prompt or a broken image can be
 * diagnosed from devtools without tailing the server. Grouped under one label per frame.
 */
const log = (...args: unknown[]) => console.info("%c[generate]", "color:#A78BFA", ...args);

/**
 * Run a generation, invoking handlers as frames arrive. Resolves when the stream ends.
 * Aborting via `signal` is expected and resolves quietly rather than reporting an error.
 */
export async function streamGeneration(
  request: GenerateRequest,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    log("request", request);
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    handlers.onError?.(
      err instanceof Error ? `Could not reach the server (${err.message}).` : "Could not reach the server."
    );
    return;
  }

  // Validation and rate-limit failures arrive as regular JSON before streaming starts.
  if (!response.ok) {
    handlers.onError?.(await readErrorBody(response));
    return;
  }

  if (!response.body) {
    handlers.onError?.("The server returned an empty response.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatch(frame, handlers);
      }
    }
    if (buffer.trim()) dispatch(buffer, handlers);
  } catch (err) {
    if (signal.aborted) return; // user pressed Stop
    handlers.onError?.(
      err instanceof Error ? `Connection lost (${err.message}).` : "Connection lost."
    );
  } finally {
    reader.releaseLock();
  }
}

function dispatch(rawFrame: string, handlers: StreamHandlers): void {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawFrame.split("\n")) {
    if (!line || line.startsWith(":")) continue; // heartbeat comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return; // ignore an unparseable frame rather than killing the stream
  }

  switch (event) {
    case "stage":
      log("stage:", (payload as { stage: Stage }).stage);
      handlers.onStage?.((payload as { stage: Stage }).stage);
      break;
    case "enhanced": {
      const enhancedEvent = payload as EnhancedEvent;
      log(
        enhancedEvent.enhanced
          ? `enhanced by ${enhancedEvent.model}:`
          : "not enhanced, using the prompt as written:",
        enhancedEvent.prompt
      );
      handlers.onEnhanced?.(enhancedEvent);
      break;
    }
    case "warning":
      log("warning:", (payload as { message: string }).message);
      handlers.onWarning?.((payload as { message: string }).message);
      break;
    case "done": {
      const doneEvent = payload as DoneEvent;
      log("done:", {
        imageUrl: doneEvent.imageUrl,
        size: `${doneEvent.width}×${doneEvent.height}`,
        seed: doneEvent.seed,
        models: `${doneEvent.textModel} → ${doneEvent.imageModel}`,
        durationMs: doneEvent.durationMs,
      });
      handlers.onDone?.(doneEvent);
      break;
    }
    case "error":
      log("error:", (payload as { message: string }).message);
      handlers.onError?.((payload as { message: string }).message);
      break;
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    if (json.error?.message) return json.error.message;
  } catch {
    // fall through to a status-based message
  }
  return response.status === 429
    ? "Too many generations. Please wait a moment and try again."
    : `The server returned ${response.status}.`;
}
