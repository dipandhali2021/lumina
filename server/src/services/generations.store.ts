/**
 * Generation records in Lakebase Postgres (Neon).
 *
 * One row per successful generation, written from the route once `done` has been sent so
 * persistence never delays the image. The image columns are filled in by a later UPDATE,
 * when the background upload to permanent storage finishes.
 *
 * Every function here is best-effort: a database that is unreachable, misconfigured, or
 * simply not set up must never cost a user their image, so failures are logged and
 * swallowed rather than thrown. `DATABASE_URL` empty disables persistence entirely.
 */
import { neon } from "@neondatabase/serverless";
import { env } from "../config/env.js";
import { logger } from "../core/logger.js";

const config = env();

/** Null when DATABASE_URL is empty — every call below then becomes a no-op. */
const sql = config.DATABASE_URL ? neon(config.DATABASE_URL) : null;

export const persistenceEnabled = sql !== null;

export interface GenerationRecord {
  originalPrompt: string;
  enhancedPrompt: string;
  enhanced: boolean;
  /** Null when Express could not determine one. Raw, so this row holds personal data. */
  clientIp: string | null;
  mode: string;
  aspectRatio: string;
  quality: string;
  width: number;
  height: number;
  seed: number;
  textModel: string;
  imageModel: string;
  durationMs: number;
}

/**
 * Insert a generation and return its id, or null if persistence is off or the write
 * failed. The id is what `attachImage` needs, so a null means the image columns for this
 * generation simply stay empty.
 */
export async function recordGeneration(
  record: GenerationRecord
): Promise<number | null> {
  if (!sql) return null;
  try {
    const rows = await sql`
      INSERT INTO generations (
        original_prompt, enhanced_prompt, enhanced, client_ip,
        mode, aspect_ratio, quality, width, height, seed,
        text_model, image_model, duration_ms
      ) VALUES (
        ${record.originalPrompt}, ${record.enhancedPrompt}, ${record.enhanced},
        ${record.clientIp}, ${record.mode}, ${record.aspectRatio}, ${record.quality},
        ${record.width}, ${record.height}, ${record.seed},
        ${record.textModel}, ${record.imageModel}, ${record.durationMs}
      )
      RETURNING id
    `;
    const id = rows[0]?.id;
    return typeof id === "number" ? id : Number(id);
  } catch (err) {
    logger.error({ err }, "failed to record generation");
    return null;
  }
}

/** Fill in where the image ended up, once the upload has completed. */
export async function attachImage(
  id: number,
  image: { url: string; key: string }
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE generations
         SET image_url = ${image.url}, image_key = ${image.key}
       WHERE id = ${id}
    `;
  } catch (err) {
    logger.error({ err, id }, "failed to attach image to generation");
  }
}
