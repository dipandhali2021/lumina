/**
 * Vercel relay support.
 *
 * The relay is a pass-through deployed elsewhere: instead of dialling the upstream host
 * directly, a request is sent to the relay with the real destination carried in headers.
 * That moves the outbound IP to the relay, which is the point — the image space meters
 * ZeroGPU per caller IP.
 *
 *   POST https://relay.example/            (the relay, whatever host it lives on)
 *   x-relay-target: https://space.hf.space (scheme + host of the real destination)
 *   x-relay-path:   /gradio_api/call/...   (path + query of the real destination)
 *
 * Method, body, and every other header pass through untouched. This is the same header
 * spec Cloudflare- and Deno-style relays use, so swapping deployments needs no code
 * change — only RELAY_URL.
 */

/** Header names the relay reads. Exported so tests assert against one definition. */
export const RELAY_TARGET_HEADER = "x-relay-target";
export const RELAY_PATH_HEADER = "x-relay-path";

export interface RelayedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Rewrite a request to travel via the relay. Pure, so the header spec is testable
 * without a network. Returns the input unchanged when `relayUrl` is empty, which is how
 * the relay stays off by default.
 *
 * Throws on a malformed target URL rather than silently sending an unrelayed request:
 * a relay that quietly falls back to a direct call defeats its own purpose.
 */
export function applyRelay(
  targetUrl: string,
  headers: Record<string, string> = {},
  relayUrl?: string
): RelayedRequest {
  const relay = relayUrl?.trim();
  if (!relay) return { url: targetUrl, headers };

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error(`Cannot relay a malformed URL: ${targetUrl}`);
  }

  return {
    url: relay,
    headers: {
      ...headers,
      [RELAY_TARGET_HEADER]: `${parsed.protocol}//${parsed.host}`,
      [RELAY_PATH_HEADER]: `${parsed.pathname}${parsed.search}`,
    },
  };
}

/**
 * True when `url` points at the relay itself.
 *
 * Needed because this relay rewrites absolute URLs found in response bodies to point
 * back at itself. Such a URL is useless to us: fetching it without the relay headers
 * returns 400, and it would fail the image proxy's host allowlist. Callers detect these
 * and fall back to reconstructing the original URL.
 */
export function pointsAtRelay(url: string, relayUrl?: string): boolean {
  const relay = relayUrl?.trim();
  if (!relay) return false;
  try {
    return new URL(url).host === new URL(relay).host;
  } catch {
    return false;
  }
}
