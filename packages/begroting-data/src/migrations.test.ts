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

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — upgradet in één keer door tot de nieuwste schema-versie
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabelNaUpgrade = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begrotingsversies'`).get();
    db.close();

    // Sinds 1D.4 bevat de volledige migratielijst ook migratie 4 — een open vanaf schema-v1 upgradet dus
    // in één stap door tot en met v4. Migratie 2's eigen tabel (begrotingsversies) is hier het bewijs dat
    // die stap daadwerkelijk is doorlopen; zie test "1D.3-1"/"1D.4-1" voor de losstaande transities.
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4]);
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

    // Nog steeds precies drie rijen (1, 2 en 3, geen dubbele toepassing) en exact dezelfde applied_at-
    // tijdstempels (bewijst dat geen enkele migratie opnieuw is uitgevoerd, niet alleen dat het
    // eindresultaat toevallig gelijk is).
    expect(rijenNaTweedeOpen).toEqual(eersteRijen);
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4]);
  });

  it("1D.3-1. migratie 2 → 3 wordt correct toegepast op een bestaande schema-v2-database", () => {
    // Simuleert een bestaande database die alleen migratie 1+2 heeft ondergaan (zoals een echte database
    // die met het 1D.2-schema is aangemaakt, vóór migratie 3 bestond).
    const dbV2 = new DatabaseSync(dbPad);
    runMigrations(dbV2, [MIGRATIONS[0]!, MIGRATIONS[1]!]);
    const tabelVoorUpgrade = dbV2.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_contract_snapshot'`).get();
    dbV2.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — upgradet in één keer door tot de nieuwste schema-versie
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_contract_snapshot', 'begroting_contract_rentroll_component', 'begroting_contract_kortingswijziging')`,
      )
      .all() as { name: string }[];
    db.close();

    // Sinds 1D.4 bevat de volledige migratielijst ook migratie 4 — deze test blijft gericht op het bewijs
    // dat migratie 3's eigen tabellen bestaan; zie test "1D.4-1" voor de losstaande 3→4-transitie.
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_contract_kortingswijziging",
      "begroting_contract_rentroll_component",
      "begroting_contract_snapshot",
    ]);
  });

  it("1D.3-2. een tweede open ná schema-v3 is idempotent: geen enkele migratie wordt opnieuw uitgevoerd", () => {
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

    expect(rijenNaTweedeOpen).toEqual(eersteRijen);
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4]);
  });

  it("1D.4-1. migratie 3 → 4 wordt correct toegepast op een bestaande schema-v3-database", () => {
    // Simuleert een bestaande database die alleen migratie 1+2+3 heeft ondergaan (zoals een echte
    // database die met het 1D.3-schema is aangemaakt, vóór migratie 4 bestond).
    const dbV3 = new DatabaseSync(dbPad);
    runMigrations(dbV3, [MIGRATIONS[0]!, MIGRATIONS[1]!, MIGRATIONS[2]!]);
    const tabelVoorUpgrade = dbV3.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_aannames'`).get();
    dbV3.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 4 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_aannames', 'begroting_contract_override', 'begroting_complex_config')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_aannames",
      "begroting_complex_config",
      "begroting_contract_override",
    ]);
  });

  it("1D.4-2. een tweede open ná schema-v4 is idempotent: geen enkele migratie wordt opnieuw uitgevoerd", () => {
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

    expect(rijenNaTweedeOpen).toEqual(eersteRijen);
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4]);
  });

  it("8. een geforceerde migratiefout laat geen half toegepaste migratie achter", () => {
    const db = openOrCreateDatabase(dbPad); // past migraties 1, 2, 3 én 4 normaal toe

    const kapotteMigratie: Migration = {
      version: 5, // versie 5: de eerstvolgende, nog niet bestaande versie na de huidige (1, 2, 3 en 4) migraties.
      description: "geforceerde testfout",
      ddl: [
        "CREATE TABLE test_fail_tabel (id INTEGER)", // deze DDL-statement slaagt op zichzelf...
        "DIT IS GEEN GELDIGE SQL",                    // ...maar deze faalt binnen dezelfde transactie.
      ],
    };

    expect(() => runMigrations(db, [...MIGRATIONS, kapotteMigratie])).toThrow(/Migratie 5/);

    // Geen dubbele/kapotte registratie: nog steeds uitsluitend schema_version 1, 2, 3 en 4 geregistreerd.
    const rijen = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    expect(rijen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4]);

    // De eerste (op zichzelf geslaagde) DDL-statement van de kapotte migratie is volledig teruggedraaid —
    // de tabel bestaat niet, want hij hoorde bij dezelfde transactie als de daaropvolgende foutieve statement.
    const kapotteTabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_fail_tabel'`).get();
    expect(kapotteTabel).toBeUndefined();

    db.close();
  });
});
