import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

/** Opent een bestaande cache read-only voor rapportquery's. Bouwt niets op — zie buildCache.ts. */
export function openCacheReadonly(path: string): DatabaseSync {
  if (!existsSync(path)) {
    throw new Error(`Cache ontbreekt op ${path} — eerst buildCache() draaien.`);
  }
  return new DatabaseSync(path, { readOnly: true });
}
