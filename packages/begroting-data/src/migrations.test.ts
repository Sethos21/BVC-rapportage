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
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5]);
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
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5]);
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

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("1D.6a-1. migratie 4 → 5 wordt correct toegepast op een bestaande schema-v4-database", () => {
    // Simuleert een bestaande database die alleen migratie 1+2+3+4 heeft ondergaan (zoals een echte
    // database die met het 1D.4-schema is aangemaakt, vóór migratie 5 bestond).
    const dbV4 = new DatabaseSync(dbPad);
    runMigrations(dbV4, [MIGRATIONS[0]!, MIGRATIONS[1]!, MIGRATIONS[2]!, MIGRATIONS[3]!]);
    const tabelVoorUpgrade = dbV4.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_module1_resultaat'`).get();
    dbV4.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 5 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_frozen_module1_resultaat', 'begroting_frozen_module1_contract', 'begroting_frozen_module1_maandregel',
            'begroting_frozen_module1_control', 'begroting_frozen_module2_resultaat', 'begroting_frozen_module2_complex',
            'begroting_frozen_module2_maandregel', 'begroting_frozen_module2_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_frozen_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_frozen_module1_contract",
      "begroting_frozen_module1_control",
      "begroting_frozen_module1_maandregel",
      "begroting_frozen_module1_resultaat",
      "begroting_frozen_module2_complex",
      "begroting_frozen_module2_control",
      "begroting_frozen_module2_maandregel",
      "begroting_frozen_module2_resultaat",
    ]);
    // 8 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 24.
    expect(triggersNaUpgrade).toHaveLength(24);
  });

  it("1D.6a-3. begroting_frozen_module1_contract en begroting_frozen_module2_complex bevatten beide een volgnr-kolom", () => {
    const db = openOrCreateDatabase(dbPad);
    const contractKolommen = db.prepare(`PRAGMA table_info(begroting_frozen_module1_contract)`).all() as { name: string }[];
    const complexKolommen = db.prepare(`PRAGMA table_info(begroting_frozen_module2_complex)`).all() as { name: string }[];
    db.close();

    expect(contractKolommen.map((k) => k.name)).toContain("volgnr");
    expect(complexKolommen.map((k) => k.name)).toContain("volgnr");
  });

  it("1D.6a-4. UNIQUE (begroting_versie_id, volgnr) wordt praktisch afgedwongen op beide tabellen", () => {
    const db = openOrCreateDatabase(dbPad);
    db.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
              VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    db.exec(`INSERT INTO begroting_frozen_module1_resultaat
              (begroting_versie_id, indexatie_percentage_algemeen, portefeuille_bruto_huur_zonder_indexatie, portefeuille_indexatie_effect,
               portefeuille_bruto_huur_met_indexatie, portefeuille_huurkorting, portefeuille_netto_huur, portefeuille_netto_huur_belast,
               portefeuille_netto_huur_onbelast, portefeuille_netto_huur_onbekende_btw)
              VALUES ('v1', '0', '0', '0', '0', '0', '0', '0', '0', '0')`);
    db.exec(`INSERT INTO begroting_frozen_module2_resultaat
              (begroting_versie_id, portefeuille_netto_huur_grondslag, portefeuille_vast_voor_indexatie, portefeuille_vast_indexatie_effect,
               portefeuille_vast_na_indexatie, portefeuille_variabele_vergoeding, portefeuille_totale_vergoeding)
              VALUES ('v1', '0', '0', '0', '0', '0', '0')`);

    const insertContract = (contractnummer: string, volgnr: number) =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_module1_contract
             (begroting_versie_id, contractnummer, volgnr, huurdernummer, huurder_naam, complexnummer, belast_onbelast,
              indexatie_percentage_gebruikt, indexatie_percentage_bron, override_scope, override_reden, effectieve_indexatiedatum,
              jaartotaal_bruto_huur_zonder_indexatie, jaartotaal_indexatie_effect, jaartotaal_bruto_huur_met_indexatie,
              jaartotaal_huurkorting, jaartotaal_netto_huur)
           VALUES (?, ?, ?, NULL, NULL, NULL, 'ONBEKEND', '0', 'ALGEMEEN', NULL, NULL, NULL, '0', '0', '0', '0', '0')`,
        )
        .run("v1", contractnummer, volgnr);

    const insertComplex = (complexnummer: string, volgnr: number) =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_module2_complex
             (begroting_versie_id, complexnummer, volgnr, vast_toegepast, variabel_toegepast, variabel_percentage_gebruikt,
              jaartotaal_netto_huur_grondslag, jaartotaal_vast_voor_indexatie, jaartotaal_vast_indexatie_effect,
              jaartotaal_vast_na_indexatie, jaartotaal_variabele_vergoeding, jaartotaal_totale_vergoeding)
           VALUES (?, ?, ?, 0, 0, NULL, '0', '0', '0', '0', '0', '0')`,
        )
        .run("v1", complexnummer, volgnr);

    // Geldig: twee verschillende volgnr's binnen dezelfde versie.
    expect(() => insertContract("0000000001", 0)).not.toThrow();
    expect(() => insertContract("0000000002", 1)).not.toThrow();
    expect(() => insertComplex("001", 0)).not.toThrow();
    expect(() => insertComplex("002", 1)).not.toThrow();

    // Ongeldig: dubbele volgnr binnen dezelfde versie wordt geweigerd (UNIQUE-constraint).
    expect(() => insertContract("0000000003", 0)).toThrow();
    expect(() => insertComplex("003", 0)).toThrow();

    // Geldig: dezelfde volgnr in een ANDERE begrotingsversie is toegestaan (UNIQUE is per versie, niet globaal).
    db.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
              VALUES ('v2', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    db.exec(`INSERT INTO begroting_frozen_module1_resultaat
              (begroting_versie_id, indexatie_percentage_algemeen, portefeuille_bruto_huur_zonder_indexatie, portefeuille_indexatie_effect,
               portefeuille_bruto_huur_met_indexatie, portefeuille_huurkorting, portefeuille_netto_huur, portefeuille_netto_huur_belast,
               portefeuille_netto_huur_onbelast, portefeuille_netto_huur_onbekende_btw)
              VALUES ('v2', '0', '0', '0', '0', '0', '0', '0', '0', '0')`);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_module1_contract
             (begroting_versie_id, contractnummer, volgnr, huurdernummer, huurder_naam, complexnummer, belast_onbelast,
              indexatie_percentage_gebruikt, indexatie_percentage_bron, override_scope, override_reden, effectieve_indexatiedatum,
              jaartotaal_bruto_huur_zonder_indexatie, jaartotaal_indexatie_effect, jaartotaal_bruto_huur_met_indexatie,
              jaartotaal_huurkorting, jaartotaal_netto_huur)
           VALUES ('v2', '0000000009', 0, NULL, NULL, NULL, 'ONBEKEND', '0', 'ALGEMEEN', NULL, NULL, NULL, '0', '0', '0', '0', '0')`,
        )
        .run(),
    ).not.toThrow();

    db.close();
  });

  it("1D.6a-2. een tweede open ná schema-v5 is idempotent: geen enkele migratie wordt opnieuw uitgevoerd", () => {
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("8. een geforceerde migratiefout laat geen half toegepaste migratie achter", () => {
    const db = openOrCreateDatabase(dbPad); // past migraties 1 t/m 5 normaal toe

    const kapotteMigratie: Migration = {
      version: 6, // versie 6: de eerstvolgende, nog niet bestaande versie na de huidige (1 t/m 5) migraties.
      description: "geforceerde testfout",
      ddl: [
        "CREATE TABLE test_fail_tabel (id INTEGER)", // deze DDL-statement slaagt op zichzelf...
        "DIT IS GEEN GELDIGE SQL",                    // ...maar deze faalt binnen dezelfde transactie.
      ],
    };

    expect(() => runMigrations(db, [...MIGRATIONS, kapotteMigratie])).toThrow(/Migratie 6/);

    // Geen dubbele/kapotte registratie: nog steeds uitsluitend schema_version 1 t/m 5 geregistreerd.
    const rijen = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    expect(rijen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5]);

    // De eerste (op zichzelf geslaagde) DDL-statement van de kapotte migratie is volledig teruggedraaid —
    // de tabel bestaat niet, want hij hoorde bij dezelfde transactie als de daaropvolgende foutieve statement.
    const kapotteTabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_fail_tabel'`).get();
    expect(kapotteTabel).toBeUndefined();

    db.close();
  });
});
