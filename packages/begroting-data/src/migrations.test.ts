import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { MIGRATIONS, runMigrations, type Migration } from "./migrations.js";

let dir: string;
let dbPad: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-migraties-"));
  dbPad = join(dir, "begrotingen.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("1. migratie 1 → 2 wordt correct toegepast op een bestaande schema-v1-database", () => {
    // Simuleert een bestaande, "oude" database die alleen migratie 1 heeft ondergaan
    // (zoals een echte database die met het 1D.1-schema is aangemaakt, vóór migratie 2 bestond).
    const dbV1 = new DatabaseSync(dbPad);
    runMigrations(dbV1, [MIGRATIONS[0]!]);
    const tabelVoorUpgrade = dbV1.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begrotingsversies'`).get();
    dbV1.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 2 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabelNaUpgrade = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begrotingsversies'`).get();
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2]);
    expect(tabelNaUpgrade).toBeDefined();
  });

  it("2. een tweede open ná schema-v2 is idempotent: geen enkele migratie wordt opnieuw uitgevoerd", () => {
    const db1 = openOrCreateDatabase(dbPad);
    const eersteRijen = db1.prepare(`SELECT schema_version, applied_at FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
      applied_at: string;
    }[];
    db1.close();

    const db2 = openOrCreateDatabase(dbPad);
    const rijenNaTweedeOpen = db2.prepare(`SELECT schema_version, applied_at FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
      applied_at: string;
    }[];
    db2.close();

    // Nog steeds precies twee rijen (1 en 2, geen dubbele toepassing) en exact dezelfde applied_at-
    // tijdstempels (bewijst dat geen enkele migratie opnieuw is uitgevoerd, niet alleen dat het
    // eindresultaat toevallig gelijk is).
    expect(rijenNaTweedeOpen).toEqual(eersteRijen);
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2]);
  });

  it("8. een geforceerde migratiefout laat geen half toegepaste migratie achter", () => {
    const db = openOrCreateDatabase(dbPad); // past migraties 1 én 2 normaal toe

    const kapotteMigratie: Migration = {
      version: 3, // versie 3: de eerstvolgende, nog niet bestaande versie na de huidige (1 en 2) migraties.
      description: "geforceerde testfout",
      ddl: [
        "CREATE TABLE test_fail_tabel (id INTEGER)", // deze DDL-statement slaagt op zichzelf...
        "DIT IS GEEN GELDIGE SQL",                    // ...maar deze faalt binnen dezelfde transactie.
      ],
    };

    expect(() => runMigrations(db, [...MIGRATIONS, kapotteMigratie])).toThrow(/Migratie 3/);

    // Geen dubbele/kapotte registratie: nog steeds uitsluitend schema_version 1 en 2 geregistreerd.
    const rijen = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    expect(rijen.map((r) => r.schema_version)).toEqual([1, 2]);

    // De eerste (op zichzelf geslaagde) DDL-statement van de kapotte migratie is volledig teruggedraaid —
    // de tabel bestaat niet, want hij hoorde bij dezelfde transactie als de daaropvolgende foutieve statement.
    const kapotteTabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_fail_tabel'`).get();
    expect(kapotteTabel).toBeUndefined();

    db.close();
  });
});
