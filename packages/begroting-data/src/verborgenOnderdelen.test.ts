import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { isModuleVerborgen, leesVerborgenModules, toonModule, verbergModule } from "./verborgenOnderdelen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-verborgen-onderdelen-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("UX_10 Verborgen onderdelen — uitsluitend Managementvergoeding, per administratie", () => {
  it("een administratie zonder verborgen markering: isModuleVerborgen = false, lege lijst", () => {
    expect(isModuleVerborgen(db, "070", "MANAGEMENT")).toBe(false);
    expect(leesVerborgenModules(db, "070")).toEqual([]);
  });

  it("verbergen -> isModuleVerborgen = true, idempotent (tweede keer verbergen gooit niet)", () => {
    verbergModule(db, "070", "MANAGEMENT", new Date("2026-10-06T00:00:00.000Z"));
    expect(isModuleVerborgen(db, "070", "MANAGEMENT")).toBe(true);
    expect(leesVerborgenModules(db, "070")).toEqual(["MANAGEMENT"]);

    expect(() => verbergModule(db, "070", "MANAGEMENT", new Date("2026-10-07T00:00:00.000Z"))).not.toThrow();
    expect(leesVerborgenModules(db, "070")).toEqual(["MANAGEMENT"]); // nog steeds precies één rij, geen duplicaat
  });

  it("weergeven (toonModule) verwijdert uitsluitend de markering, is idempotent op een al-zichtbaar onderdeel", () => {
    verbergModule(db, "070", "MANAGEMENT");
    toonModule(db, "070", "MANAGEMENT");
    expect(isModuleVerborgen(db, "070", "MANAGEMENT")).toBe(false);

    expect(() => toonModule(db, "070", "MANAGEMENT")).not.toThrow();
    expect(isModuleVerborgen(db, "070", "MANAGEMENT")).toBe(false);
  });

  it("verbergen is strikt per administratie — een andere administratie blijft onaangeroerd", () => {
    verbergModule(db, "070", "MANAGEMENT");
    expect(isModuleVerborgen(db, "070", "MANAGEMENT")).toBe(true);
    expect(isModuleVerborgen(db, "071", "MANAGEMENT")).toBe(false);
    expect(leesVerborgenModules(db, "071")).toEqual([]);
  });
});
