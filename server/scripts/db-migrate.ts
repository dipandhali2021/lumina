/**
 * Applies the SQL files in ./migrations to the database in DATABASE_URL, in name order.
 *
 * Deliberately minimal: each file is sent as one statement batch and is expected to be
 * idempotent (every DDL uses IF NOT EXISTS), so re-running is safe and no ledger table
 * is needed. If migrations ever stop being idempotent, this needs a real ledger.
 *
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadDotEnv } from "../src/config/env.ts";

loadDotEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Run `neon link` (or `neon env pull`) first, or export it."
  );
  process.exit(1);
}

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${migrationsDir}`);
  process.exit(1);
}

const sql = neon(url);

/**
 * Split a file into single statements. The HTTP driver accepts one statement per call, so
 * a naive semicolon split is enough here — none of the DDL contains a function body or a
 * dollar-quoted string, which are the only places a semicolon can appear harmlessly. Add
 * a real parser (or switch to the WebSocket Pool) before writing one that does.
 */
function statementsIn(source: string): string[] {
  return source
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

for (const file of files) {
  const source = readFileSync(join(migrationsDir, file), "utf8");
  const statements = statementsIn(source);
  process.stdout.write(`applying ${file} (${statements.length} statements) … `);
  await sql.transaction(statements.map((s) => sql.query(s)));
  console.log("ok");
}

console.log(`\n${files.length} migration(s) applied.`);
