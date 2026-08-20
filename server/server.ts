/**
 * Vercel entrypoint. Vercel detects the framework from this file's `express` import,
 * introspects the routes off the exported app, and bundles it as a single function.
 *
 * The app itself is built in src/index.ts, which also owns the local `.listen()` path.
 */
import "express";
import app from "./src/index.js";

export default app;
