/**
 * Coupon state for advanced ("Think") mode.
 *
 * The server holds the valid codes and is the real gate; this module only remembers which
 * code the user typed so the toggle stays unlocked across reloads. A code in localStorage
 * is not a secret being protected — it is the user's own code, on their own machine.
 */

const STORAGE_KEY = "lumina.coupon";

/** Reads the saved code. Returns null in private modes where storage throws. */
export function savedCoupon(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveCoupon(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage unavailable; the coupon simply won't survive a reload.
  }
}

export function clearCoupon(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never available.
  }
}

export type CouponCheck =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Ask the server whether a code is valid. Used to give immediate feedback when a code is
 * entered; generation re-checks it server-side regardless, so a stale "ok" here can only
 * cost a failed generation, never an ungated one.
 */
export async function checkCoupon(code: string): Promise<CouponCheck> {
  let response: Response;
  try {
    response = await fetch("/api/coupon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coupon: code }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }

  if (response.ok) return { ok: true };

  try {
    const json = (await response.json()) as { error?: { message?: string } };
    if (json.error?.message) return { ok: false, message: json.error.message };
  } catch {
    // fall through
  }
  return {
    ok: false,
    message:
      response.status === 429
        ? "Too many attempts. Please wait a moment."
        : "That code isn't valid.",
  };
}
