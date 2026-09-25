import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostname } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, LockBezetError, releaseLock, withLock } from "./lock.js";

let dir: string;
let lockPad: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-lock-"));
  lockPad = join(dir, ".lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("acquireLock / releaseLock", () => {
  it("staat een tweede acquire toe nadat de eerste is vrijgegeven", () => {
    acquireLock(lockPad);
    releaseLock(lockPad);
    expect(() => acquireLock(lockPad)).not.toThrow();
    releaseLock(lockPad);
  });

  it("weigert een tweede acquire terwijl een recente lock nog actief is", () => {
    acquireLock(lockPad);
    expect(() => acquireLock(lockPad)).toThrow(LockBezetError);
    releaseLock(lockPad);
  });

  it("herstelt automatisch (met waarschuwing) een achtergebleven lock ouder dan de staleness-drempel", () => {
    const oudeLock = { pid: 999999, hostname: hostname(), acquiredAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() };
    writeFileSync(lockPad, JSON.stringify(oudeLock));
    expect(() => acquireLock(lockPad)).not.toThrow();
    releaseLock(lockPad);
  });
});

describe("withLock", () => {
  it("geeft de lock altijd vrij, ook als de functie een fout gooit", async () => {
    await expect(withLock(lockPad, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // Lock moet vrij zijn — een nieuwe acquire mag niet blokkeren.
    expect(() => acquireLock(lockPad)).not.toThrow();
    releaseLock(lockPad);
  });
});
