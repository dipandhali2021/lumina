/**
 * Coupon codes that unlock advanced mode.
 *
 * Advanced mode is the expensive path — it spends Vercel AI Gateway credits on a frontier
 * model for every prompt — so it is gated rather than free to anyone who finds the API.
 * Valid codes live in `ADVANCED_COUPONS` and are never sent to the browser; the client
 * submits a code and is told only whether it worked.
 *
 * This is a shared-secret gate, not user accounts: one code can be used any number of
 * times by anyone who has it. It stops casual abuse of the endpoint, and rotating a leaked
 * code is an env change plus a redeploy.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const config = env();

/** SHA-256 of each configured code, so comparison is fixed-length and timing-safe. */
const digests = config.ADVANCED_COUPONS.map(digestOf);

/**
 * False when no codes are configured, which locks advanced mode rather than opening it.
 * "Unlocked by a coupon" has to mean something when the list is empty, and a missing env
 * var quietly granting the expensive path to everyone is the wrong way to fail.
 */
export const couponsConfigured = digests.length > 0;

export function isValidCoupon(code: string | undefined): boolean {
  if (!code) return false;
  const candidate = digestOf(code.trim());
  // Compare against every code even after a match: bailing early would leak which position
  // in the list matched through the response time.
  let matched = false;
  for (const digest of digests) {
    if (timingSafeEqual(candidate, digest)) matched = true;
  }
  return matched;
}

function digestOf(code: string): Buffer {
  return createHash("sha256").update(code, "utf8").digest();
}
