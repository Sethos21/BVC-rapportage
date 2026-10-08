import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-pkg-"));
  dbPad = join(dir, "begrotingen.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openOrCreateDatabase", () => {
  it("1. maakt een nieuw databasebestand aan op het opgegeven pad", () => {
    expect(existsSync(dbPad)).toBe(false);
    const db = openOrCreateDatabase(dbPad);
    db.close();
    expect(existsSync(dbPad)).toBe(true);
  });

  it("2. begroting_schema_meta bestaat na openen", () => {
    const db = openOrCreateDatabase(dbPad);
    const tabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_schema_meta'`).get();
    db.close();
    expect(tabel).toBeDefined();
  });

  it("3. schema-versie 1 is geregistreerd in begroting_schema_meta", () => {
    // Sinds 1D.2 bevat de standaard-migratielijst ook migratie 2 (begrotingsversies) — een verse open
    // past dus beide toe. Deze test blijft gericht op uitsluitend het bestaan van de schema_version=1-rij
    // (1D.1's eigen scope); zie migrations.test.ts's tests 1/2 voor de volledige (1 én 2) migratieketen.
    const db = openOrCreateDatabase(dbPad);
    const rijen = db.prepare(`SELECT schema_version, applied_at FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
      applied_at: string;
    }[];
    db.close();
    const rijVoorVersie1 = rijen.find((r) => r.schema_version === 1);
    expect(rijVoorVersie1).toBeDefined();
    expect(typeof rijVoorVersie1!.applied_at).toBe("string");
    expect(rijVoorVersie1!.applied_at.length).toBeGreaterThan(0);
  });

  it("5. PRAGMA foreign_keys staat ON", () => {
    const db = openOrCreateDatabase(dbPad);
    const resultaat = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    db.close();
    expect(resultaat.foreign_keys).toBe(1);
  });

  it("6. PRAGMA journal_mode staat op WAL", () => {
    const db = openOrCreateDatabase(dbPad);
    const resultaat = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();
    expect(resultaat.journal_mode.toLowerCase()).toBe("wal");
  });

  it("7. PRAGMA busy_timeout staat op 5000", () => {
    const db = openOrCreateDatabase(dbPad);
    const resultaat = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    db.close();
    expect(resultaat.timeout).toBe(5000);
  });

  it("na een migratiefout via openOrCreateDatabase zelf blijft geen lingering handle/lock over — het bestand is meteen daarna weer normaal bruikbaar", () => {
    // Corrumpeer het doelbestand vooraf zodat migratie 1's eigen CREATE TABLE faalt ("table already
    // exists") — uitsluitend via de PUBLIEKE openOrCreateDatabase-aanroep geforceerd, geen interne
    // migratielijst-injectie nodig (dat is al gedekt door migrations.test.ts's eigen rollback-test).
    const vooraf = new DatabaseSync(dbPad);
    vooraf.exec(`CREATE TABLE begroting_schema_meta (schema_version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    vooraf.close();

    expect(() => openOrCreateDatabase(dbPad)).toThrow();

    // Geen lingering filehandle/lock: een nieuwe, onafhankelijke connectie moet het bestand
    // meteen daarna weer probleemloos kunnen openen en gebruiken (geen "database is locked").
    const db = new DatabaseSync(dbPad);
    db.exec("PRAGMA foreign_keys = ON");
    const resultaat = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    db.close();
    expect(resultaat.foreign_keys).toBe(1);
  });
});
