/**
 * Opaque id -> upstream image URL.
 *
 * Keeps the provider's host out of the browser: the client only ever sees
 * /api/images/:id, so swapping image backends never changes anything client-side.
 * In-memory with a TTL and a hard cap (insertion-ordered Map = cheap LRU-by-age).
 */
import { randomBytes } from "node:crypto";

interface Entry {
  url: string;
  contentType?: string;
  /**
   * Headers the proxy must send to fetch `url` — an API key for providers that require
   * one. Held in memory only, never serialized into the id or into a log line.
   */
  fetchHeaders?: Readonly<Record<string, string>>;
  /**
   * Relay the proxy must fetch `url` through. Set when the image was generated behind a
   * relay and the host only serves it to the egress that generated it.
   */
  fetchRelayUrl?: string;
  expiresAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — comfortably outlives a browsing session
const MAX_ENTRIES = 500;

const store = new Map<string, Entry>();

function newId(): string {
  return `img_${randomBytes(9).toString("base64url")}`;
}

function evictExpired(now: number): void {
  for (const [id, entry] of store) {
    if (entry.expiresAt > now) break; // insertion order ≈ expiry order
    store.delete(id);
  }
}

/** How the proxy must fetch the stored URL. Grouped so callers pass one value. */
export interface ImageRefFetch {
  fetchHeaders?: Readonly<Record<string, string>>;
  fetchRelayUrl?: string;
}

export function putImageRef(url: string, how: ImageRefFetch = {}): string {
  const now = Date.now();
  evictExpired(now);
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  const id = newId();
  store.set(id, {
    url,
    expiresAt: now + TTL_MS,
    ...(how.fetchHeaders ? { fetchHeaders: how.fetchHeaders } : {}),
    ...(how.fetchRelayUrl ? { fetchRelayUrl: how.fetchRelayUrl } : {}),
  });
  return id;
}

export function getImageRef(id: string): Entry | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(id);
    return null;
  }
  return entry;
}

/** Cache the observed content type so repeat requests don't have to re-sniff it. */
export function rememberContentType(id: string, contentType: string): void {
  const entry = store.get(id);
  if (entry) entry.contentType = contentType;
}

export function imageRefCount(): number {
  return store.size;
}
