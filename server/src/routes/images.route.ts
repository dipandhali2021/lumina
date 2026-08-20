/**
 * GET /api/images/:id — streams the upstream image through this server.
 *
 * Two reasons to proxy rather than hand out the provider's URL: the client stays
 * decoupled from whichever image backend is in use, and provider URLs (which can
 * expire when a space restarts) never end up baked into the DOM.
 */
import { Router, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { env } from "../config/env.js";
import { logger } from "../core/logger.js";
import { applyRelay } from "../http/relay.js";
import { getImageRef, rememberContentType } from "../services/image-ref.store.js";

const config = env();
const ALLOWED_HOSTS = new Set(config.ZIMAGE_ALLOWED_HOSTS.map((h) => h.toLowerCase()));
const FETCH_TIMEOUT_MS = 60_000;

export const imagesRouter = Router();

imagesRouter.get("/images/:id", async (req: Request, res: Response) => {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const ref = id ? getImageRef(id) : null;
  if (!ref) {
    res.status(404).json({
      error: { code: "not_found", message: "Image not found or expired." },
    });
    return;
  }

  // The stored URL came from an upstream response body, so it is untrusted input:
  // proxying it unchecked would turn this endpoint into an SSRF gadget.
  let target: URL;
  try {
    target = new URL(ref.url);
  } catch {
    res.status(502).json({
      error: { code: "upstream_error", message: "Malformed image URL." },
    });
    return;
  }

  if (
    (target.protocol !== "https:" && target.protocol !== "http:") ||
    !ALLOWED_HOSTS.has(target.hostname.toLowerCase())
  ) {
    logger.warn({ host: target.hostname }, "blocked image proxy to disallowed host");
    res.status(403).json({
      error: { code: "upstream_error", message: "Image host not allowed." },
    });
    return;
  }

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on("close", onClose);

  try {
    // Relayed only when the generator asked for it, and only after `target` has cleared
    // the allowlist above — the rewrite must never be able to skip that check.
    const { url: fetchUrl, headers: fetchHeaders } = applyRelay(
      target.toString(),
      // Some providers (Pollinations) require an API key to serve the bytes. It is held
      // with the ref rather than in the URL, so it never reaches a log or the browser.
      { ...(ref.fetchHeaders ?? {}) },
      ref.fetchRelayUrl
    );

    const upstream = await fetch(fetchUrl, {
      ...(Object.keys(fetchHeaders).length > 0 ? { headers: fetchHeaders } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({
        error: {
          code: "upstream_error",
          message: `Could not fetch the image (${upstream.status}).`,
        },
      });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "image/webp";
    if (!contentType.startsWith("image/")) {
      res.status(502).json({
        error: { code: "upstream_error", message: "Upstream did not return an image." },
      });
      return;
    }
    rememberContentType(id!, contentType);

    logger.info(
      {
        imageId: id,
        upstreamUrl: ref.url,
        contentType,
        bytes: upstream.headers.get("content-length"),
      },
      "image served"
    );

    res.setHeader("Content-Type", contentType);
    // Ids are single-use and opaque, so the bytes behind one never change.
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    const length = upstream.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);

    await streamPipeline(Readable.fromWeb(upstream.body as never), res);
  } catch (err) {
    if (controller.signal.aborted) return; // client left mid-download
    logger.error({ err }, "image proxy failed");
    if (!res.headersSent) {
      res.status(502).json({
        error: { code: "upstream_error", message: "Could not fetch the image." },
      });
    } else {
      res.end();
    }
  } finally {
    res.off("close", onClose);
  }
});
