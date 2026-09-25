import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";

interface LockPayload {
  pid: number;
  hostname: string;
  acquiredAt: string;
}

/**
 * Eenvoudige bestandslock voor schrijfacties (geen gedistribueerde locking —
 * expliciet niet gevraagd). Een lock ouder dan STALE_MS wordt als
 * achtergebleven na een crash beschouwd en zichtbaar (console.warn)
 * automatisch hersteld, i.p.v. de applicatie permanent te blokkeren.
 * Leeftijd i.p.v. proces-liveness-controle omdat dit cross-platform
 * (Windows/macOS-werkcomputers) moet werken zonder OS-specifieke process-APIs.
 */
const STALE_MS = 10 * 60 * 1000;

export class LockBezetError extends Error {}

export function acquireLock(lockPad: string): void {
  mkdirSync(dirname(lockPad), { recursive: true });

  if (existsSync(lockPad)) {
    const bestaand = JSON.parse(readFileSync(lockPad, "utf-8")) as LockPayload;
    const leeftijdMs = Date.now() - new Date(bestaand.acquiredAt).getTime();
    if (leeftijdMs < STALE_MS) {
      throw new LockBezetError(
        `Bezet door proces ${bestaand.pid} op ${bestaand.hostname} sinds ${bestaand.acquiredAt}. Wacht tot die schrijfactie klaar is.`,
      );
    }
    console.warn(
      `Achtergebleven lock (${leeftijdMs}ms oud, proces ${bestaand.pid}@${bestaand.hostname}) automatisch hersteld — vermoedelijk een crash tijdens een vorige schrijfactie.`,
    );
  }

  const payload: LockPayload = { pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString() };
  writeFileSync(lockPad, JSON.stringify(payload, null, 2), "utf-8");
}

export function releaseLock(lockPad: string): void {
  if (existsSync(lockPad)) rmSync(lockPad);
}

export async function withLock<T>(lockPad: string, fn: () => Promise<T> | T): Promise<T> {
  acquireLock(lockPad);
  try {
    return await fn();
  } finally {
    releaseLock(lockPad);
  }
}
