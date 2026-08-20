/**
 * Shared upstream HTTP helpers: one timeout policy, one retry policy, one place to
 * change them. Both provider families use these instead of calling fetch directly.
 */
import { TimeoutError, UpstreamError, isAbortError } from "../core/errors.js";
import { applyRelay } from "./relay.js";

export interface UpstreamRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Per-attempt deadline. */
  timeoutMs: number;
  /** Caller's cancellation signal (client disconnect). */
  signal: AbortSignal;
  /** Retry attempts on 429/5xx/network error. 0 = single attempt. */
  retries?: number;
  /** Label used in error messages, e.g. "Groq". */
  label: string;
  /**
   * Send via a Vercel relay instead of dialling `url` directly. Opt-in per request —
   * callers that omit it keep going direct.
   */
  relayUrl?: string;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Keep a provider's explanation short enough to sit in a UI row. */
const MAX_REASON_CHARS = 240;
/** Read enough of an error body to parse it; only a prefix is kept for logs. */
const MAX_ERROR_BODY_CHARS = 4000;
const MAX_DETAIL_CHARS = 500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with jitter, so parallel clients don't retry in lockstep. */
function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 400 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

/**
 * Perform a request with a per-attempt timeout, honouring the caller's abort signal.
 * Returns the raw Response so callers can stream the body when they need to.
 */
export async function upstreamFetch(req: UpstreamRequest): Promise<Response> {
  const retries = req.retries ?? 2;
  let lastError: unknown;

  // Resolved once, outside the retry loop: the rewrite is deterministic.
  const { url: requestUrl, headers: requestHeaders } = applyRelay(
    req.url,
    req.headers ?? {},
    req.relayUrl
  );

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");

    // Per-attempt deadline, combined with the caller's signal so either can cancel.
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = AbortSignal.any([req.signal, timeout]);

    try {
      const response = await fetch(requestUrl, {
        method: req.method ?? "GET",
        headers: {
          ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...requestHeaders,
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        signal,
      });

      if (response.ok) return response;

      const detail = await safeErrorBody(response);
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        lastError = new UpstreamError(
          `${req.label} returned ${response.status}.`,
          detail.slice(0, MAX_DETAIL_CHARS)
        );
        await sleep(backoffMs(attempt), req.signal);
        continue;
      }
      // Prefer the provider's own explanation: "free tier rate-limited, top up credits"
      // and "model not found" both need a different response from the user, and a bare
      // status code can't tell them apart.
      const reason = describeUpstreamReason(detail);
      throw new UpstreamError(
        reason
          ? `${req.label}: ${reason}`
          : `${req.label} returned ${response.status}${
              response.status === 429 ? " (rate limited). Try again in a moment." : "."
            }`,
        detail.slice(0, MAX_DETAIL_CHARS)
      );
    } catch (err) {
      // Caller cancelled — propagate immediately, never retry.
      if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");

      if (isAbortError(err)) {
        lastError = new TimeoutError(
          `${req.label} timed out after ${req.timeoutMs}ms.`
        );
      } else if (err instanceof UpstreamError) {
        throw err;
      } else {
        lastError = new UpstreamError(
          `${req.label} is unreachable.`,
          err instanceof Error ? err.message : String(err)
        );
      }

      if (attempt >= retries) break;
      await sleep(backoffMs(attempt), req.signal);
    }
  }

  throw lastError ?? new UpstreamError(`${req.label} failed.`);
}

/** As above, but parses a JSON body and fails cleanly when the response isn't JSON. */
export async function upstreamJson<T>(req: UpstreamRequest): Promise<T> {
  const response = await upstreamFetch(req);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(
      `${req.label} returned a non-JSON response.`,
      text.slice(0, 500)
    );
  }
}

async function safeErrorBody(response: Response): Promise<string> {
  try {
    // A truncated body cannot be parsed, and these providers nest the useful message
    // inside a large JSON envelope, so read generously and trim only for the log.
    return (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    return "";
  }
}

/**
 * Pull the human-readable reason out of an OpenAI-style error body
 * (`{ error: { message } }`, or a bare `{ message }` / string). Returns "" when the body
 * carries nothing useful, so the caller can fall back to the status code.
 */
export function describeUpstreamReason(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some gateways answer with plain text (an HTML error page is not worth showing).
    return trimmed.startsWith("<") ? "" : trimmed.slice(0, MAX_REASON_CHARS);
  }

  if (typeof parsed === "string") return parsed.trim().slice(0, MAX_REASON_CHARS);
  if (!parsed || typeof parsed !== "object") return "";

  const root = parsed as { error?: unknown; message?: unknown };
  const candidates: unknown[] = [root.error, root.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, MAX_REASON_CHARS);
    }
    if (candidate && typeof candidate === "object") {
      const { message } = candidate as { message?: unknown };
      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, MAX_REASON_CHARS);
      }
    }
  }
  return "";
}
