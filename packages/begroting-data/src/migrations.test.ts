import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { leesPnLBronmappingRegels, leesPnLMappingWijzigingLog, voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "./pnlBronmappingRepository.js";
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
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger'
         AND (name LIKE 'trg_begroting_frozen_module1_%' OR name LIKE 'trg_begroting_frozen_module2_%')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
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
    expect(rijenNaTweedeOpen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
  });

  it("2C.2-1. migratie 5 → 6 wordt correct toegepast op een bestaande schema-v5-database", () => {
    // Simuleert een bestaande database die alleen migratie 1+2+3+4+5 heeft ondergaan (zoals een echte
    // database die met het 1D.6a-schema is aangemaakt, vóór migratie 6 bestond).
    const dbV5 = new DatabaseSync(dbPad);
    runMigrations(dbV5, [MIGRATIONS[0]!, MIGRATIONS[1]!, MIGRATIONS[2]!, MIGRATIONS[3]!, MIGRATIONS[4]!]);
    const tabelVoorUpgrade = dbV5.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_management_invoer'`).get();
    dbV5.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 6 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabelNaUpgrade = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_management_invoer'`).get();
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_management_invoer_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabelNaUpgrade).toBeDefined();
    // 1 tabel × 3 triggers (INSERT/UPDATE/DELETE).
    expect(triggersNaUpgrade).toHaveLength(3);
  });

  it("2C.4-1. migratie 6 → 7 wordt correct toegepast op een bestaande schema-v6-database", () => {
    // Simuleert een bestaande database die alleen migratie 1+2+3+4+5+6 heeft ondergaan (zoals een echte
    // database die met het 2C.2-schema is aangemaakt, vóór migratie 7 bestond).
    const dbV6 = new DatabaseSync(dbPad);
    runMigrations(dbV6, [MIGRATIONS[0]!, MIGRATIONS[1]!, MIGRATIONS[2]!, MIGRATIONS[3]!, MIGRATIONS[4]!, MIGRATIONS[5]!]);
    const tabelVoorUpgrade = dbV6.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_module3_resultaat'`).get();
    dbV6.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 7 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_frozen_module3_resultaat', 'begroting_frozen_module3_maandregel', 'begroting_frozen_module3_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_frozen_module3_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_frozen_module3_control",
      "begroting_frozen_module3_maandregel",
      "begroting_frozen_module3_resultaat",
    ]);
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
  });

  it("2C.4-2. begroting_management_invoer (migratie 6) blijft ongewijzigd aanwezig na de upgrade naar migratie 7", () => {
    // Bewijst dat migratie 7 uitsluitend frozen Module-3-output toevoegt en migratie 6 (input) niet raakt.
    const db = openOrCreateDatabase(dbPad);
    const tabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_management_invoer'`).get();
    db.close();
    expect(tabel).toBeDefined();
  });

  it("GO-P1-1. migratie 7 → 8 wordt correct toegepast op een bestaande schema-v7-database", () => {
    // Simuleert een bestaande database die alleen migratie 1..7 heeft ondergaan (zoals een echte
    // database die met het 2C.4-schema is aangemaakt, vóór migratie 8 bestond).
    const dbV7 = new DatabaseSync(dbPad);
    runMigrations(dbV7, [MIGRATIONS[0]!, MIGRATIONS[1]!, MIGRATIONS[2]!, MIGRATIONS[3]!, MIGRATIONS[4]!, MIGRATIONS[5]!, MIGRATIONS[6]!]);
    const tabelVoorUpgrade = dbV7.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_gepland_onderhoud_activiteit'`).get();
    dbV7.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 8 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_gepland_onderhoud_activiteit', 'begroting_gepland_onderhoud_module')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_gepland_onderhoud_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(["begroting_gepland_onderhoud_activiteit", "begroting_gepland_onderhoud_module"]);
    // 2 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("GO-P1-2. begroting_frozen_module3_resultaat (migratie 7) blijft ongewijzigd aanwezig na de upgrade naar migratie 8", () => {
    // Bewijst dat migratie 8 uitsluitend Gepland-Onderhoud-concept-input toevoegt en migratie 7 niet raakt.
    const db = openOrCreateDatabase(dbPad);
    const tabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_module3_resultaat'`).get();
    db.close();
    expect(tabel).toBeDefined();
  });

  it("GO-P3-1. migratie 8 → 9 wordt correct toegepast op een bestaande schema-v8-database", () => {
    // Simuleert een bestaande database die alleen migratie 1..8 heeft ondergaan (zoals een echte
    // database die met het GO-P1-schema is aangemaakt, vóór migratie 9 bestond).
    const dbV8 = new DatabaseSync(dbPad);
    runMigrations(dbV8, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
    ]);
    const tabelVoorUpgrade = dbV8.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_gepland_onderhoud_resultaat'`).get();
    dbV8.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 9 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_frozen_gepland_onderhoud_resultaat', 'begroting_frozen_gepland_onderhoud_activiteit',
            'begroting_frozen_gepland_onderhoud_complex', 'begroting_frozen_gepland_onderhoud_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_frozen_gepland_onderhoud_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_frozen_gepland_onderhoud_activiteit",
      "begroting_frozen_gepland_onderhoud_complex",
      "begroting_frozen_gepland_onderhoud_control",
      "begroting_frozen_gepland_onderhoud_resultaat",
    ]);
    // 4 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 12.
    expect(triggersNaUpgrade).toHaveLength(12);
  });

  it("GO-P3-2. begroting_gepland_onderhoud_activiteit (migratie 8) blijft ongewijzigd aanwezig na de upgrade naar migratie 9", () => {
    // Bewijst dat migratie 9 uitsluitend Gepland-Onderhoud-frozen-output toevoegt en migratie 8 (input) niet raakt.
    const db = openOrCreateDatabase(dbPad);
    const tabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_gepland_onderhoud_activiteit'`).get();
    db.close();
    expect(tabel).toBeDefined();
  });

  it("CD-P3-1. migratie 10 → 11 wordt correct toegepast op een bestaande schema-v10-database", () => {
    // Simuleert een bestaande database die alleen migratie 1..10 heeft ondergaan (zoals een echte
    // database die met het CD-P1-schema is aangemaakt, vóór migratie 11 bestond).
    const dbV10 = new DatabaseSync(dbPad);
    runMigrations(dbV10, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
    ]);
    const tabelVoorUpgrade = dbV10
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_correctief_dagelijks_onderhoud_resultaat'`)
      .get();
    dbV10.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 11 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_frozen_correctief_dagelijks_onderhoud_resultaat', 'begroting_frozen_correctief_dagelijks_onderhoud_regel',
            'begroting_frozen_correctief_dagelijks_onderhoud_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_frozen_correctief_dagelijks_onderhoud_%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_frozen_correctief_dagelijks_onderhoud_control",
      "begroting_frozen_correctief_dagelijks_onderhoud_regel",
      "begroting_frozen_correctief_dagelijks_onderhoud_resultaat",
    ]);
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
  });

  it("CD-P3-2. begroting_correctief_dagelijks_onderhoud_regel (migratie 10) blijft ongewijzigd aanwezig na de upgrade naar migratie 11", () => {
    // Bewijst dat migratie 11 uitsluitend Correctief/Dagelijks-frozen-output toevoegt en migratie 10 (input) niet raakt.
    const db = openOrCreateDatabase(dbPad);
    const tabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_correctief_dagelijks_onderhoud_regel'`).get();
    db.close();
    expect(tabel).toBeDefined();
  });

  it("OB032-1. migratie 11 → 12 wordt correct toegepast op een bestaande schema-v11-database", () => {
    // Simuleert een bestaande database die alleen migratie 1..11 heeft ondergaan (zoals een echte
    // database die met het CD-P3-schema is aangemaakt, vóór migratie 12 bestond).
    const dbV11 = new DatabaseSync(dbPad);
    runMigrations(dbV11, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
    ]);
    const tabelVoorUpgrade = dbV11.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_verzekering_regel'`).get();
    dbV11.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 13 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('begroting_verzekering_regel', 'begroting_verzekering_module')`)
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_verzekering_%' AND name NOT LIKE '%frozen%'`)
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(["begroting_verzekering_module", "begroting_verzekering_regel"]);
    // 2 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB032-2. migratie 12 → 13 wordt correct toegepast op een bestaande schema-v12-database", () => {
    const dbV12 = new DatabaseSync(dbPad);
    runMigrations(dbV12, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
    ]);
    const tabelVoorUpgrade = dbV12.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_verzekering_resultaat'`).get();
    dbV12.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad);
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('begroting_frozen_verzekering_resultaat', 'begroting_frozen_verzekering_regel', 'begroting_frozen_verzekering_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_begroting_frozen_verzekering_%'`)
      .all() as { name: string }[];
    // Migratie 12 (input) blijft ongewijzigd aanwezig na de upgrade naar migratie 13 (output).
    const regelTabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_verzekering_regel'`).get();
    db.close();

    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual([
      "begroting_frozen_verzekering_control",
      "begroting_frozen_verzekering_regel",
      "begroting_frozen_verzekering_resultaat",
    ]);
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
    expect(regelTabel).toBeDefined();
  });

  it("OB033-1. migratie 13 → 14 wordt correct toegepast op een bestaande schema-v13-database", () => {
    const dbV13 = new DatabaseSync(dbPad);
    runMigrations(dbV13, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
    ]);
    const tabelVoorUpgrade = dbV13.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_woz_object'`).get();
    dbV13.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 14 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('begroting_gemeentelijke_lasten_module', 'begroting_woz_object')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_insert',
           'trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_update',
           'trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_delete',
           'trg_begroting_woz_object_vastgesteld_no_insert',
           'trg_begroting_woz_object_vastgesteld_no_update',
           'trg_begroting_woz_object_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(["begroting_gemeentelijke_lasten_module", "begroting_woz_object"]);
    // 2 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB033-P3-1. migratie 14 → 15 wordt correct toegepast op een bestaande schema-v14-database", () => {
    const dbV14 = new DatabaseSync(dbPad);
    runMigrations(dbV14, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
    ]);
    const tabelVoorUpgrade = dbV14
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_gemeentelijke_lasten_resultaat'`)
      .get();
    dbV14.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 15 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_frozen_gemeentelijke_lasten_resultaat',
           'begroting_frozen_woz_object',
           'begroting_frozen_gemeentelijke_lasten_complex',
           'begroting_frozen_gemeentelijke_lasten_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_insert',
           'trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_update',
           'trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_delete',
           'trg_begroting_frozen_woz_object_vastgesteld_no_insert',
           'trg_begroting_frozen_woz_object_vastgesteld_no_update',
           'trg_begroting_frozen_woz_object_vastgesteld_no_delete',
           'trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_insert',
           'trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_update',
           'trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_delete',
           'trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_insert',
           'trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_update',
           'trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      [
        "begroting_frozen_gemeentelijke_lasten_complex",
        "begroting_frozen_gemeentelijke_lasten_control",
        "begroting_frozen_gemeentelijke_lasten_resultaat",
        "begroting_frozen_woz_object",
      ].sort(),
    );
    // 4 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 12.
    expect(triggersNaUpgrade).toHaveLength(12);
  });

  it("OB035036-1. migratie 15 → 16 wordt correct toegepast op een bestaande schema-v15-database", () => {
    const dbV15 = new DatabaseSync(dbPad);
    runMigrations(dbV15, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
    ]);
    const tabelVoorUpgrade = dbV15.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_algemene_kosten_classificatie'`).get();
    dbV15.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 16 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_algemene_kosten_classificatie',
           'begroting_algemene_kosten_categorie_state',
           'begroting_algemene_kosten_regel')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_algemene_kosten_categorie_state_vastgesteld_no_insert',
           'trg_begroting_algemene_kosten_categorie_state_vastgesteld_no_update',
           'trg_begroting_algemene_kosten_categorie_state_vastgesteld_no_delete',
           'trg_begroting_algemene_kosten_regel_vastgesteld_no_insert',
           'trg_begroting_algemene_kosten_regel_vastgesteld_no_update',
           'trg_begroting_algemene_kosten_regel_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_algemene_kosten_classificatie", "begroting_algemene_kosten_categorie_state", "begroting_algemene_kosten_regel"].sort(),
    );
    // classificatie krijgt bewust GEEN triggers (geen begroting_versie_id) — 2 tabellen × 3 triggers = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB035036-2. migratie 16 → 17 wordt correct toegepast op een bestaande schema-v16-database", () => {
    const dbV16 = new DatabaseSync(dbPad);
    runMigrations(dbV16, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
    ]);
    const tabelVoorUpgrade = dbV16
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_algemene_kosten_classificatie'`)
      .get();
    dbV16.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 17 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_frozen_algemene_kosten_classificatie',
           'begroting_frozen_algemene_kosten_categorie',
           'begroting_frozen_algemene_kosten_regel',
           'begroting_frozen_algemene_kosten_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_frozen_algemene_kosten_classificatie_vastgesteld_no_insert',
           'trg_begroting_frozen_algemene_kosten_classificatie_vastgesteld_no_update',
           'trg_begroting_frozen_algemene_kosten_classificatie_vastgesteld_no_delete',
           'trg_begroting_frozen_algemene_kosten_categorie_vastgesteld_no_insert',
           'trg_begroting_frozen_algemene_kosten_categorie_vastgesteld_no_update',
           'trg_begroting_frozen_algemene_kosten_categorie_vastgesteld_no_delete',
           'trg_begroting_frozen_algemene_kosten_regel_vastgesteld_no_insert',
           'trg_begroting_frozen_algemene_kosten_regel_vastgesteld_no_update',
           'trg_begroting_frozen_algemene_kosten_regel_vastgesteld_no_delete',
           'trg_begroting_frozen_algemene_kosten_control_vastgesteld_no_insert',
           'trg_begroting_frozen_algemene_kosten_control_vastgesteld_no_update',
           'trg_begroting_frozen_algemene_kosten_control_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      [
        "begroting_frozen_algemene_kosten_classificatie",
        "begroting_frozen_algemene_kosten_categorie",
        "begroting_frozen_algemene_kosten_regel",
        "begroting_frozen_algemene_kosten_control",
      ].sort(),
    );
    // 4 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 12.
    expect(triggersNaUpgrade).toHaveLength(12);
  });

  it("OB031-1. migratie 17 → 18 wordt correct toegepast op een bestaande schema-v17-database", () => {
    const dbV17 = new DatabaseSync(dbPad);
    runMigrations(dbV17, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
    ]);
    const tabelVoorUpgrade = dbV17.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_leegstand_classificatie'`).get();
    dbV17.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 19 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_leegstand_classificatie',
           'begroting_leegstand_categorie_state',
           'begroting_leegstand_regel')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_leegstand_categorie_state_vastgesteld_no_insert',
           'trg_begroting_leegstand_categorie_state_vastgesteld_no_update',
           'trg_begroting_leegstand_categorie_state_vastgesteld_no_delete',
           'trg_begroting_leegstand_regel_vastgesteld_no_insert',
           'trg_begroting_leegstand_regel_vastgesteld_no_update',
           'trg_begroting_leegstand_regel_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_leegstand_classificatie", "begroting_leegstand_categorie_state", "begroting_leegstand_regel"].sort(),
    );
    // classificatie krijgt bewust GEEN triggers (geen begroting_versie_id) — 2 tabellen × 3 triggers = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB031-2. migratie 18 → 19 wordt correct toegepast op een bestaande schema-v18-database", () => {
    const dbV18 = new DatabaseSync(dbPad);
    runMigrations(dbV18, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
      MIGRATIONS[17]!,
    ]);
    const tabelVoorUpgrade = dbV18.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_leegstand_categorie'`).get();
    dbV18.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 19 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_frozen_leegstand_categorie',
           'begroting_frozen_leegstand_regel',
           'begroting_frozen_leegstand_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_frozen_leegstand_categorie_vastgesteld_no_insert',
           'trg_begroting_frozen_leegstand_categorie_vastgesteld_no_update',
           'trg_begroting_frozen_leegstand_categorie_vastgesteld_no_delete',
           'trg_begroting_frozen_leegstand_regel_vastgesteld_no_insert',
           'trg_begroting_frozen_leegstand_regel_vastgesteld_no_update',
           'trg_begroting_frozen_leegstand_regel_vastgesteld_no_delete',
           'trg_begroting_frozen_leegstand_control_vastgesteld_no_insert',
           'trg_begroting_frozen_leegstand_control_vastgesteld_no_update',
           'trg_begroting_frozen_leegstand_control_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_frozen_leegstand_categorie", "begroting_frozen_leegstand_regel", "begroting_frozen_leegstand_control"].sort(),
    );
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
  });

  it("OB037038-1. migratie 19 → 20 wordt correct toegepast op een bestaande schema-v19-database", () => {
    const dbV19 = new DatabaseSync(dbPad);
    runMigrations(dbV19, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
      MIGRATIONS[17]!,
      MIGRATIONS[18]!,
    ]);
    const tabelVoorUpgrade = dbV19.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_rente_classificatie'`).get();
    dbV19.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 21 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_rente_classificatie',
           'begroting_rente_categorie_state',
           'begroting_rente_regel')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_rente_categorie_state_vastgesteld_no_insert',
           'trg_begroting_rente_categorie_state_vastgesteld_no_update',
           'trg_begroting_rente_categorie_state_vastgesteld_no_delete',
           'trg_begroting_rente_regel_vastgesteld_no_insert',
           'trg_begroting_rente_regel_vastgesteld_no_update',
           'trg_begroting_rente_regel_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_rente_classificatie", "begroting_rente_categorie_state", "begroting_rente_regel"].sort(),
    );
    // classificatie krijgt bewust GEEN triggers (geen begroting_versie_id) — 2 tabellen × 3 triggers = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB037038-2. migratie 20 → 21 wordt correct toegepast op een bestaande schema-v20-database", () => {
    const dbV20 = new DatabaseSync(dbPad);
    runMigrations(dbV20, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
      MIGRATIONS[17]!,
      MIGRATIONS[18]!,
      MIGRATIONS[19]!,
    ]);
    const tabelVoorUpgrade = dbV20.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_rente_categorie'`).get();
    dbV20.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 21 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_frozen_rente_categorie',
           'begroting_frozen_rente_regel',
           'begroting_frozen_rente_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_frozen_rente_categorie_vastgesteld_no_insert',
           'trg_begroting_frozen_rente_categorie_vastgesteld_no_update',
           'trg_begroting_frozen_rente_categorie_vastgesteld_no_delete',
           'trg_begroting_frozen_rente_regel_vastgesteld_no_insert',
           'trg_begroting_frozen_rente_regel_vastgesteld_no_update',
           'trg_begroting_frozen_rente_regel_vastgesteld_no_delete',
           'trg_begroting_frozen_rente_control_vastgesteld_no_insert',
           'trg_begroting_frozen_rente_control_vastgesteld_no_update',
           'trg_begroting_frozen_rente_control_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_frozen_rente_categorie", "begroting_frozen_rente_regel", "begroting_frozen_rente_control"].sort(),
    );
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
  });

  it("OB039-1. migratie 21 → 22 wordt correct toegepast op een bestaande schema-v21-database", () => {
    const dbV21 = new DatabaseSync(dbPad);
    runMigrations(dbV21, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
      MIGRATIONS[17]!,
      MIGRATIONS[18]!,
      MIGRATIONS[19]!,
      MIGRATIONS[20]!,
    ]);
    const tabelVoorUpgrade = dbV21.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_geplande_verkoop_classificatie'`).get();
    dbV21.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 23 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_geplande_verkoop_classificatie',
           'begroting_geplande_verkoop_grootboek_classificatie',
           'begroting_geplande_verkoop_module',
           'begroting_geplande_verkoop_regel',
           'begroting_geplande_verkoop_estimated_regel')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_geplande_verkoop_module_vastgesteld_no_insert',
           'trg_begroting_geplande_verkoop_module_vastgesteld_no_update',
           'trg_begroting_geplande_verkoop_module_vastgesteld_no_delete',
           'trg_begroting_geplande_verkoop_regel_vastgesteld_no_insert',
           'trg_begroting_geplande_verkoop_regel_vastgesteld_no_update',
           'trg_begroting_geplande_verkoop_regel_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      [
        "begroting_geplande_verkoop_classificatie",
        "begroting_geplande_verkoop_grootboek_classificatie",
        "begroting_geplande_verkoop_module",
        "begroting_geplande_verkoop_regel",
        "begroting_geplande_verkoop_estimated_regel",
      ].sort(),
    );
    // beide classificatietabellen en de Estimated-regeltabel krijgen bewust GEEN triggers — module + Begrotingsregel: 2 tabellen × 3 triggers = 6.
    expect(triggersNaUpgrade).toHaveLength(6);
  });

  it("OB039-2. migratie 22 → 23 wordt correct toegepast op een bestaande schema-v22-database", () => {
    const dbV22 = new DatabaseSync(dbPad);
    runMigrations(dbV22, [
      MIGRATIONS[0]!,
      MIGRATIONS[1]!,
      MIGRATIONS[2]!,
      MIGRATIONS[3]!,
      MIGRATIONS[4]!,
      MIGRATIONS[5]!,
      MIGRATIONS[6]!,
      MIGRATIONS[7]!,
      MIGRATIONS[8]!,
      MIGRATIONS[9]!,
      MIGRATIONS[10]!,
      MIGRATIONS[11]!,
      MIGRATIONS[12]!,
      MIGRATIONS[13]!,
      MIGRATIONS[14]!,
      MIGRATIONS[15]!,
      MIGRATIONS[16]!,
      MIGRATIONS[17]!,
      MIGRATIONS[18]!,
      MIGRATIONS[19]!,
      MIGRATIONS[20]!,
      MIGRATIONS[21]!,
    ]);
    const tabelVoorUpgrade = dbV22.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_frozen_geplande_verkoop_resultaat'`).get();
    dbV22.close();
    expect(tabelVoorUpgrade).toBeUndefined();

    const db = openOrCreateDatabase(dbPad); // volledige, huidige migratielijst — moet naar schema 23 upgraden
    const versies = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    const tabellenNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
           'begroting_frozen_geplande_verkoop_resultaat',
           'begroting_frozen_geplande_verkoop_regel',
           'begroting_frozen_geplande_verkoop_control')`,
      )
      .all() as { name: string }[];
    const triggersNaUpgrade = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
           'trg_begroting_frozen_geplande_verkoop_resultaat_vastgesteld_no_insert',
           'trg_begroting_frozen_geplande_verkoop_resultaat_vastgesteld_no_update',
           'trg_begroting_frozen_geplande_verkoop_resultaat_vastgesteld_no_delete',
           'trg_begroting_frozen_geplande_verkoop_regel_vastgesteld_no_insert',
           'trg_begroting_frozen_geplande_verkoop_regel_vastgesteld_no_update',
           'trg_begroting_frozen_geplande_verkoop_regel_vastgesteld_no_delete',
           'trg_begroting_frozen_geplande_verkoop_control_vastgesteld_no_insert',
           'trg_begroting_frozen_geplande_verkoop_control_vastgesteld_no_update',
           'trg_begroting_frozen_geplande_verkoop_control_vastgesteld_no_delete')`,
      )
      .all() as { name: string }[];
    db.close();

    expect(versies.map((v) => v.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(tabellenNaUpgrade.map((t) => t.name).sort()).toEqual(
      ["begroting_frozen_geplande_verkoop_resultaat", "begroting_frozen_geplande_verkoop_regel", "begroting_frozen_geplande_verkoop_control"].sort(),
    );
    // 3 tabellen × 3 triggers (INSERT/UPDATE/DELETE) = 9.
    expect(triggersNaUpgrade).toHaveLength(9);
  });

  it("8. een geforceerde migratiefout laat geen half toegepaste migratie achter", () => {
    const db = openOrCreateDatabase(dbPad); // past migraties 1 t/m 36 normaal toe

    const kapotteMigratie: Migration = {
      version: 37, // versie 37: de eerstvolgende, nog niet bestaande versie na de huidige (1 t/m 36) migraties.
      description: "geforceerde testfout",
      ddl: [
        "CREATE TABLE test_fail_tabel (id INTEGER)", // deze DDL-statement slaagt op zichzelf...
        "DIT IS GEEN GELDIGE SQL",                    // ...maar deze faalt binnen dezelfde transactie.
      ],
    };

    expect(() => runMigrations(db, [...MIGRATIONS, kapotteMigratie])).toThrow(/Migratie 37/);

    // Geen dubbele/kapotte registratie: nog steeds uitsluitend schema_version 1 t/m 36 geregistreerd.
    const rijen = db.prepare(`SELECT schema_version FROM begroting_schema_meta ORDER BY schema_version`).all() as {
      schema_version: number;
    }[];
    expect(rijen.map((r) => r.schema_version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);

    // De eerste (op zichzelf geslaagde) DDL-statement van de kapotte migratie is volledig teruggedraaid —
    // de tabel bestaat niet, want hij hoorde bij dezelfde transactie als de daaropvolgende foutieve statement.
    const kapotteTabel = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_fail_tabel'`).get();
    expect(kapotteTabel).toBeUndefined();

    db.close();
  });

  it("9. migratie 26: bestaande ERVARING_BEHEERDER-legacywaarde (live concept-tabel) wordt veilig naar OVERIG omgezet, nieuwe kolommen krijgen een eerlijke lege/afwezige default", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 25));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    // Pre-migratie-26 schema: geen grootboekrekening/ogb_kostensoort-kolommen, ERVARING_BEHEERDER was toen nog geldig.
    dbOud
      .prepare(
        `INSERT INTO begroting_gepland_onderhoud_activiteit
           (begroting_versie_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, status, leverancier, offertebedrag, notitie)
         VALUES ('v1', '003', 'Terrasherstel', 'ERVARING_BEHEERDER', 'Ervaring beheerder; terugkerend herstel buitenterrein.', '500', '0', '0', '0', 'GEPLAND', NULL, NULL, NULL)`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad); // upgradet in één keer door tot en met migratie 26
    const rij = db.prepare(`SELECT complexnummer, omschrijving, grootboekrekening, ogb_kostensoort, aanleiding_type, q1 FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = 'v1'`).get() as {
      complexnummer: string;
      omschrijving: string;
      grootboekrekening: string;
      ogb_kostensoort: string | null;
      aanleiding_type: string;
      q1: string;
    };
    db.close();

    // De legacywaarde is veilig gemigreerd — geen enkel ander veld van de rij is verloren gegaan.
    expect(rij.aanleiding_type).toBe("OVERIG");
    expect(rij.complexnummer).toBe("003");
    expect(rij.omschrijving).toBe("Terrasherstel");
    expect(rij.q1).toBe("500");
    // Nieuwe kolommen: eerlijke "nog niet ingevuld"-default voor een rij die vóór deze migratie al bestond.
    expect(rij.grootboekrekening).toBe("");
    expect(rij.ogb_kostensoort).toBeNull();
  });

  it("10. migratie 26: frozen Gepland-Onderhoud-activiteit met ERVARING_BEHEERDER wordt veilig gemigreerd, en de CHECK staat de legacywaarde niet langer toe", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 25));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud.exec(`INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
                (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
                VALUES ('v1', '500', '0', '0', '0', '500', '0', 1, 'REVIEWED_WITH_ACTIVITIES')`);
    // Pre-migratie-26 schema: geen grootboekrekening/ogb_kostensoort, ERVARING_BEHEERDER was toen nog een geldige CHECK-waarde.
    dbOud
      .prepare(
        `INSERT INTO begroting_frozen_gepland_onderhoud_activiteit
           (begroting_versie_id, activiteit_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, jaartotaal, status)
         VALUES ('v1', 1, '003', 'Terrasherstel', 'ERVARING_BEHEERDER', 'Ervaring beheerder; terugkerend herstel buitenterrein.', '500', '0', '0', '0', '500', 'GEPLAND')`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const rij = db
      .prepare(`SELECT complexnummer, grootboekrekening, ogb_kostensoort, aanleiding_type, jaartotaal FROM begroting_frozen_gepland_onderhoud_activiteit WHERE begroting_versie_id = 'v1'`)
      .get() as { complexnummer: string; grootboekrekening: string; ogb_kostensoort: string | null; aanleiding_type: string; jaartotaal: string };

    expect(rij.aanleiding_type).toBe("OVERIG");
    expect(rij.complexnummer).toBe("003");
    expect(rij.jaartotaal).toBe("500");
    expect(rij.grootboekrekening).toBe("");
    expect(rij.ogb_kostensoort).toBeNull();

    // De herbouwde tabel staat ERVARING_BEHEERDER niet meer toe als geldige CHECK-waarde.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_activiteit
             (begroting_versie_id, activiteit_id, complexnummer, omschrijving, grootboekrekening, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, jaartotaal, status)
           VALUES ('v1', 2, '003', 'x', '4300', 'ERVARING_BEHEERDER', 'x', '0', '0', '0', '0', '0', 'GEPLAND')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    db.close();
  });

  it("11. migratie 26: Correctief/Dagelijks-Onderhoud (live + frozen) krijgt grootboekrekening/ogb_kostensoort additief, bestaande rij blijft intact", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 25));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_correctief_dagelijks_onderhoud_regel (begroting_versie_id, omschrijving, complexnummer, jaarbedrag)
         VALUES ('v1', 'Reparatie CV-installatie', '003', '1200')`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const rij = db
      .prepare(`SELECT omschrijving, complexnummer, grootboekrekening, ogb_kostensoort, jaarbedrag FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = 'v1'`)
      .get() as { omschrijving: string; complexnummer: string; grootboekrekening: string; ogb_kostensoort: string | null; jaarbedrag: string };
    db.close();

    expect(rij.omschrijving).toBe("Reparatie CV-installatie");
    expect(rij.complexnummer).toBe("003");
    expect(rij.jaarbedrag).toBe("1200");
    expect(rij.grootboekrekening).toBe("");
    expect(rij.ogb_kostensoort).toBeNull();
  });

  it("12. migratie 27: Estimated-tabellen (Gepland + Correctief/Dagelijks) upgraden schoon vanaf schema 26, FK/CASCADE en UPSERT-sleutel werken zoals ontworpen", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 26));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_gepland_onderhoud_activiteit
           (begroting_versie_id, complexnummer, omschrijving, grootboekrekening, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, status)
         VALUES ('v1', '003', 'Terrasherstel', '4300', 'MJOP', 'MJOP 2027 regel 3', '500', '0', '0', '0', 'GEPLAND')`,
      )
      .run();
    dbOud
      .prepare(
        `INSERT INTO begroting_correctief_dagelijks_onderhoud_regel (begroting_versie_id, omschrijving, complexnummer, grootboekrekening, jaarbedrag)
         VALUES ('v1', 'Reparatie CV-installatie', '003', '4300', '1200')`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad); // upgradet in één keer door tot en met migratie 27
    db.exec("PRAGMA foreign_keys = ON");

    const activiteitId = (db.prepare(`SELECT id FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = 'v1'`).get() as { id: number }).id;
    const regelId = (db.prepare(`SELECT id FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = 'v1'`).get() as { id: number }).id;

    // UPSERT-sleutel (activiteit_id/regel_id als PRIMARY KEY): tweede schrijfactie werkt bij, geen dubbele rij.
    db.prepare(
      `INSERT INTO begroting_gepland_onderhoud_estimated_verwachting (activiteit_id, begroting_versie_id, q1, q2, q3, q4) VALUES (?, 'v1', '100', '0', '0', '0')
       ON CONFLICT(activiteit_id) DO UPDATE SET q1 = excluded.q1`,
    ).run(activiteitId);
    db.prepare(
      `INSERT INTO begroting_gepland_onderhoud_estimated_verwachting (activiteit_id, begroting_versie_id, q1, q2, q3, q4) VALUES (?, 'v1', '999', '0', '0', '0')
       ON CONFLICT(activiteit_id) DO UPDATE SET q1 = excluded.q1`,
    ).run(activiteitId);
    const verwachtingRijen = db.prepare(`SELECT q1 FROM begroting_gepland_onderhoud_estimated_verwachting WHERE begroting_versie_id = 'v1'`).all() as { q1: string }[];
    expect(verwachtingRijen).toHaveLength(1);
    expect(verwachtingRijen[0]!.q1).toBe("999");

    db.prepare(`INSERT INTO begroting_correctief_dagelijks_onderhoud_estimated_verwachting (regel_id, begroting_versie_id, resterend_bedrag) VALUES (?, 'v1', NULL)`).run(regelId);
    db.prepare(`INSERT INTO begroting_gepland_onderhoud_estimated_only_activiteit (begroting_versie_id, complexnummer, omschrijving, grootboekrekening, ogb_kostensoort, q1, q2, q3, q4) VALUES ('v1', '003', 'Onvoorzien', '4300', NULL, '0', '0', '0', '0')`).run();
    db.prepare(`INSERT INTO begroting_correctief_dagelijks_onderhoud_estimated_only_regel (begroting_versie_id, omschrijving, complexnummer, grootboekrekening, ogb_kostensoort, resterend_bedrag) VALUES ('v1', 'Onvoorzien', NULL, '4300', NULL, NULL)`).run();

    // ON DELETE CASCADE: het verwijderen van de bronactiviteit/-regel verwijdert de gekoppelde resterende-verwachtingsrij.
    db.prepare(`DELETE FROM begroting_gepland_onderhoud_activiteit WHERE id = ?`).run(activiteitId);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM begroting_gepland_onderhoud_estimated_verwachting WHERE begroting_versie_id = 'v1'`).get()).toEqual({ n: 0 });

    // GEEN VASTGESTELD-immutability-triggers: blijft schrijfbaar na vaststellen (bewezen door simpelweg te kunnen schrijven zonder trigger-fout hierboven/hieronder).
    db.prepare(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-08-01T00:00:00.000Z' WHERE id = 'v1'`).run();
    expect(() =>
      db.prepare(`INSERT INTO begroting_correctief_dagelijks_onderhoud_estimated_only_regel (begroting_versie_id, omschrijving, complexnummer, grootboekrekening, ogb_kostensoort, resterend_bedrag) VALUES ('v1', 'Na vaststellen', NULL, '4300', NULL, '42')`).run(),
    ).not.toThrow();

    db.close();
  });

  it("13. migratie 28: Canon-erfpacht-tabellen upgraden schoon vanaf schema 27, NULL ≠ '0' blijft onderscheiden, VASTGESTELD-triggers blokkeren wijziging", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 27));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud.close();

    const db = openOrCreateDatabase(dbPad); // upgradet door tot en met migratie 28
    db.prepare(
      `INSERT INTO begroting_canon_erfpacht_regel (begroting_versie_id, complexnummer, grootboekrekening, ogb_kostensoort, jaarcanon, index_percentage)
       VALUES ('v1', '003', '4400', NULL, NULL, NULL), ('v1', '004', '4400', NULL, '0', NULL)`,
    ).run();
    const rijen = db.prepare(`SELECT complexnummer, jaarcanon FROM begroting_canon_erfpacht_regel ORDER BY id`).all() as { complexnummer: string; jaarcanon: string | null }[];
    expect(rijen).toEqual([
      { complexnummer: "003", jaarcanon: null },
      { complexnummer: "004", jaarcanon: "0" },
    ]);
    db.prepare(`INSERT INTO begroting_canon_erfpacht_module (begroting_versie_id, beoordeeld) VALUES ('v1', 1)`).run();

    db.prepare(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-08-01T00:00:00.000Z' WHERE id = 'v1'`).run();
    expect(() => db.prepare(`UPDATE begroting_canon_erfpacht_regel SET jaarcanon = '5' WHERE begroting_versie_id = 'v1'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_canon_erfpacht_module SET beoordeeld = 0 WHERE begroting_versie_id = 'v1'`).run()).toThrow(/immutable/);
    db.close();
  });

  it("14. migratie 29: Verzekering-regels (live + frozen) krijgen grootboekrekening/ogb_kostensoort additief, bestaande rij blijft intact", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 28));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_verzekering_regel (begroting_versie_id, complexnummer, verzekeraar, ingangsdatum, looptijd_maanden, bedrag, index_percentage, handmatig_begroot_override)
         VALUES ('v1', '001', 'Gilde', '2020-07-01', 12, '12000', '3', NULL)`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const rij = db.prepare(`SELECT verzekeraar, bedrag, grootboekrekening, ogb_kostensoort FROM begroting_verzekering_regel WHERE begroting_versie_id = 'v1'`).get() as {
      verzekeraar: string;
      bedrag: string;
      grootboekrekening: string;
      ogb_kostensoort: string | null;
    };
    const frozenKolommen = (db.prepare(`PRAGMA table_info(begroting_frozen_verzekering_regel)`).all() as { name: string }[]).map((k) => k.name);
    db.close();

    expect(rij).toEqual({ verzekeraar: "Gilde", bedrag: "12000", grootboekrekening: "", ogb_kostensoort: null });
    expect(frozenKolommen).toEqual(expect.arrayContaining(["grootboekrekening", "ogb_kostensoort"]));
  });

it("15. migratie 30: WOZ-object krijgt object_type/unitnummer i.p.v. vrij adres; bestaande rij blijft intact met NULL-objectkeuze; enum-CHECK actief", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 29));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_woz_object (begroting_versie_id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override)
         VALUES ('v1', '001', 'Kerkstraat 1', 2026, '2026-01-01', '1000000', NULL)`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const kolommen = (db.prepare(`PRAGMA table_info(begroting_woz_object)`).all() as { name: string }[]).map((k) => k.name);
    const frozenKolommen = (db.prepare(`PRAGMA table_info(begroting_frozen_woz_object)`).all() as { name: string }[]).map((k) => k.name);
    const rij = db.prepare(`SELECT complexnummer, aanslagjaar, werkelijke_woz, object_type, unitnummer FROM begroting_woz_object WHERE begroting_versie_id = 'v1'`).get();
    expect(kolommen).not.toContain("woz_object_adres");
    expect(frozenKolommen).not.toContain("woz_object_adres");
    expect(frozenKolommen).toEqual(expect.arrayContaining(["object_type", "unitnummer"]));
    expect(rij).toEqual({ complexnummer: "001", aanslagjaar: 2026, werkelijke_woz: "1000000", object_type: null, unitnummer: null });

    expect(() => db.prepare(`UPDATE begroting_woz_object SET object_type = 'ADRES' WHERE begroting_versie_id = 'v1'`).run()).toThrow(/CHECK constraint failed/);
    db.prepare(`UPDATE begroting_woz_object SET object_type = 'UNIT', unitnummer = 'A-12' WHERE begroting_versie_id = 'v1'`).run();
    db.close();
  });

it("16. migratie 31: Verzekering-Estimated-per-polis-tabel upgradet schoon vanaf schema 30, PK/UPSERT, CASCADE en geen immutability-triggers", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 30));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_verzekering_regel (begroting_versie_id, complexnummer, verzekeraar, grootboekrekening, ingangsdatum, looptijd_maanden, bedrag, index_percentage, handmatig_begroot_override)
         VALUES ('v1', '001', 'Gilde', '4130', '2020-07-01', 12, '12000', '3', NULL)`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const regelId = (db.prepare(`SELECT id FROM begroting_verzekering_regel WHERE begroting_versie_id = 'v1'`).get() as { id: number }).id;
    const upsert = `INSERT INTO begroting_verzekering_estimated_polis (regel_id, begroting_versie_id, handmatige_resterende_verwachting) VALUES (?, 'v1', ?)
                    ON CONFLICT(regel_id) DO UPDATE SET handmatige_resterende_verwachting = excluded.handmatige_resterende_verwachting`;
    db.prepare(upsert).run(regelId, "0");
    db.prepare(upsert).run(regelId, "-5");
    expect(db.prepare(`SELECT handmatige_resterende_verwachting AS v FROM begroting_verzekering_estimated_polis`).all()).toEqual([{ v: "-5" }]);
    expect(() => db.prepare(`INSERT INTO begroting_verzekering_estimated_polis (regel_id, begroting_versie_id, handmatige_resterende_verwachting) VALUES (999, 'v1', NULL)`).run()).toThrow();

    db.prepare(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-08-01T00:00:00.000Z' WHERE id = 'v1'`).run();
    expect(() => db.prepare(upsert).run(regelId, "7")).not.toThrow(); // geen VASTGESTELD-trigger: Estimated blijft wijzigbaar

    const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'begroting_verzekering_estimated_polis'`).all();
    expect(triggers).toEqual([]);
    db.close();
  });

it("17. migratie 32: woz_set_bevestigd (module-staat + frozen) additief, bestaande rijen blijven intact en zijn niet bevestigd", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 31));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_gemeentelijke_lasten_module (begroting_versie_id, werkelijke_gemeentelijke_lasten, woz_stijging_percentage, lasten_percentage_stijging, begrotings_percentage_override, beoordeeld)
         VALUES ('v1', '9000', '10', '5', NULL, 1)`,
      )
      .run();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const rij = db.prepare(`SELECT werkelijke_gemeentelijke_lasten AS lasten, beoordeeld, woz_set_bevestigd FROM begroting_gemeentelijke_lasten_module WHERE begroting_versie_id = 'v1'`).get();
    const frozenKolommen = (db.prepare(`PRAGMA table_info(begroting_frozen_gemeentelijke_lasten_resultaat)`).all() as { name: string }[]).map((k) => k.name);
    expect(rij).toEqual({ lasten: "9000", beoordeeld: 1, woz_set_bevestigd: 0 });
    expect(frozenKolommen).toContain("woz_set_bevestigd");
    expect(() => db.prepare(`UPDATE begroting_gemeentelijke_lasten_module SET woz_set_bevestigd = 2 WHERE begroting_versie_id = 'v1'`).run()).toThrow(/CHECK constraint failed/);
    db.close();
  });

it("18. migratie 30 (DROP COLUMN) is technisch mogelijk op de SQLite van deze runtime: versie ≥ 3.35.0", () => {
    const db = openOrCreateDatabase(dbPad);
    const versie = (db.prepare(`SELECT sqlite_version() AS v`).get() as { v: string }).v;
    db.close();
    const [major, minor] = versie.split(".").map(Number) as [number, number];
    expect(major > 3 || (major === 3 && minor >= 35)).toBe(true);
  });

  it("19. PRODUCTIEVORM: een schema-25 pnl-bronmapping-database (de enige productie-database die `openOrCreateDatabase` opent) behoudt na migraties 26-36 al haar mapping- en logdata identiek; alle begrotingstabellen die migratie 26-36 raken zijn leeg en de database blijft integer", () => {
    const mutatie = (overrides: Partial<PnLBronmappingMutatieInvoer>): PnLBronmappingMutatieInvoer => ({
      bedrijfsnr: "070",
      grootboekrekening: "4700",
      grootboekOmschrijving: "WOZ / OZB",
      ogbKostensoort: "4701",
      ogbKostensoortOmschrijving: "OZB",
      economischeModule: "GEMEENTELIJKE_LASTEN",
      economischeCategorie: "GEMEENTELIJKE_LASTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      type: "NIEUWE_MAPPING_VANAF_PERIODE",
      vorigeMappingId: null,
      gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"),
      gebruiker: "migratietest",
      wijzigingsreden: "bewijs productievorm",
      ...overrides,
    });

    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 25));
    voegPnLBronmappingMutatieToe(dbOud, mutatie({}));
    voegPnLBronmappingMutatieToe(dbOud, mutatie({ grootboekrekening: "4710", grootboekOmschrijving: "Gemeentelijke heffingen", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
    voegPnLBronmappingMutatieToe(
      dbOud,
      mutatie({ grootboekrekening: "4130", grootboekOmschrijving: "Verzekering", ogbKostensoort: "4131", ogbKostensoortOmschrijving: "Brand-/opstalverzekering", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" }),
    );
    const snapshot = (db: DatabaseSync) => JSON.stringify({ regels: leesPnLBronmappingRegels(db, "070"), log: leesPnLMappingWijzigingLog(db, "070") });
    const voor = snapshot(dbOud);
    const integriteitVoor = dbOud.prepare(`PRAGMA integrity_check`).all();
    dbOud.close();
    expect(JSON.parse(voor).regels).toHaveLength(3);
    expect(integriteitVoor).toEqual([{ integrity_check: "ok" }]);

    const db = openOrCreateDatabase(dbPad); // 26 t/m 36 in één keer
    expect(snapshot(db)).toBe(voor);
    expect(db.prepare(`PRAGMA integrity_check`).all()).toEqual([{ integrity_check: "ok" }]);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);

    const geraakteTabellen = [
      "begroting_gepland_onderhoud_activiteit",
      "begroting_frozen_gepland_onderhoud_activiteit",
      "begroting_correctief_dagelijks_onderhoud_regel",
      "begroting_frozen_correctief_dagelijks_onderhoud_regel",
      "begroting_verzekering_regel",
      "begroting_frozen_verzekering_regel",
      "begroting_woz_object",
      "begroting_frozen_woz_object",
      "begroting_gemeentelijke_lasten_module",
      "begroting_gemeentelijke_lasten_regel",
      "begroting_frozen_gemeentelijke_lasten_resultaat",
      "begroting_frozen_gemeentelijke_lasten_regel",
      "begroting_frozen_gemeentelijke_lasten_regel_control",
      "begroting_algemene_kosten_estimated_verwachting",
      "begroting_gemeentelijke_lasten_estimated_verwachting",
      "begrotingsversies",
    ];
    for (const tabel of geraakteTabellen) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).get(), tabel).toEqual({ n: 0 });
    }
    db.close();
  });

  it("20. migratie 30 is verliesarm voor alles behalve het bewust vervallen vrije adresveld: alle overige kolommen van een bestaande WOZ-rij (concept én frozen) blijven exact behouden", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 29));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud
      .prepare(
        `INSERT INTO begroting_woz_object (begroting_versie_id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override)
         VALUES ('v1', '001', 'Kerkstraat 1', 2026, '2026-01-01', '1234567.89', '1300000')`,
      )
      .run();
    const voor = dbOud.prepare(`SELECT id, begroting_versie_id, complexnummer, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override FROM begroting_woz_object`).all();
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const na = db.prepare(`SELECT id, begroting_versie_id, complexnummer, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override FROM begroting_woz_object`).all();
    expect(na).toEqual(voor);
    db.close();
  });

it("21. migratie 33: Gemeentelijke lasten per GL is additief — bestaande frozen-resultaatrijen (van vóór 33) blijven intact met een onbekende (NULL) bevroren post, en de nieuwe tabellen zijn VASTGESTELD-immutable", () => {
    const dbOud = new DatabaseSync(dbPad);
    runMigrations(dbOud, MIGRATIONS.filter((m) => m.version <= 32));
    dbOud.exec(`INSERT INTO begrotingsversies (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, created_at, based_on_version_id, origin_type)
                VALUES ('v1', '070', 2027, '2026-07-31', 'CONCEPT', '2026-01-01T00:00:00.000Z', NULL, 'NIEUW')`);
    dbOud.exec(`INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat
                  (begroting_versie_id, beoordeeld, woz_set_bevestigd, review_status, totale_werkelijke_woz, historisch_lasten_percentage,
                   automatisch_begrotings_percentage, effectief_begrotings_percentage, totale_automatisch_verwachte_woz, totale_effectief_verwachte_woz, begrote_gemeentelijke_lasten)
                VALUES ('v1', 1, 1, 'REVIEWED_ZERO_OBJECTS', '0', '0', '0', '0', '0', '0', '0')`);
    dbOud.close();

    const db = openOrCreateDatabase(dbPad);
    const rij = db.prepare(`SELECT begrote_gemeentelijke_lasten, begrote_lasten_post FROM begroting_frozen_gemeentelijke_lasten_resultaat WHERE begroting_versie_id = 'v1'`).get();
    expect(rij).toEqual({ begrote_gemeentelijke_lasten: "0", begrote_lasten_post: null });
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);

    // Immutability: een concept-regel kan bij CONCEPT worden geschreven, niet meer na VASTGESTELD.
    db.exec(`INSERT INTO begroting_gemeentelijke_lasten_regel (begroting_versie_id, grootboekrekening, ogb_kostensoort, jaarbedrag) VALUES ('v1', '4710', NULL, '100')`);
    db.exec(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-09-25T00:00:00.000Z' WHERE id = 'v1'`);
    expect(() => db.exec(`INSERT INTO begroting_gemeentelijke_lasten_regel (begroting_versie_id, grootboekrekening, ogb_kostensoort, jaarbedrag) VALUES ('v1', '4700', NULL, '1')`)).toThrow(/VASTGESTELD/);
    expect(() => db.exec(`UPDATE begroting_gemeentelijke_lasten_regel SET jaarbedrag = '999' WHERE begroting_versie_id = 'v1'`)).toThrow(/VASTGESTELD/);
    expect(() => db.exec(`DELETE FROM begroting_gemeentelijke_lasten_regel WHERE begroting_versie_id = 'v1'`)).toThrow(/VASTGESTELD/);
    expect(() => db.exec(`INSERT INTO begroting_frozen_gemeentelijke_lasten_regel (begroting_versie_id, regel_id, volgnr, grootboekrekening, ogb_kostensoort, jaarbedrag) VALUES ('v1', 1, 0, '4710', NULL, '100')`)).toThrow(/VASTGESTELD/);
    expect(() => db.exec(`INSERT INTO begroting_frozen_gemeentelijke_lasten_regel_control (begroting_versie_id, volgnr, regel_id, ernst, bericht) VALUES ('v1', 0, NULL, 'WAARSCHUWING', 'x')`)).toThrow(/VASTGESTELD/);
    db.close();
  });
});
