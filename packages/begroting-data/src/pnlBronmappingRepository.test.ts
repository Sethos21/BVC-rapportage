import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  berekenWerkelijkRenteViaCentraleMapping,
  resolveerPnLBronmapping,
  type PnLBronmappingRegel,
  type RenteRuweBoekingRegel,
} from "@bvc/reporting";
import { openOrCreateDatabase } from "./database.js";
import {
  leesPnLBronmappingRegels,
  leesPnLMappingWijzigingLog,
  voegPnLBronmappingMutatieToe,
  type PnLBronmappingMutatieInvoer,
} from "./pnlBronmappingRepository.js";

/**
 * FASE M4 — persistence-/repositorybewijs voor de centrale
 * P&L-bronmappingarchitectuur. Zie `pnlBronmappingRepository.ts`'s
 * moduledoc en migratie 24 (`migrations.ts`) voor het volledige ontwerp.
 */

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-pnl-bronmapping-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ACTOR = "test-actor@bvc.local";

function mutatie(overrides: Partial<PnLBronmappingMutatieInvoer> = {}): PnLBronmappingMutatieInvoer {
  return {
    bedrijfsnr: "023",
    grootboekrekening: "4600",
    grootboekOmschrijving: null,
    ogbKostensoort: "4601",
    ogbKostensoortOmschrijving: "Rente lening .962",
    economischeModule: "RENTE",
    economischeCategorie: "RENTEKOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"),
    gebruiker: ACTOR,
    wijzigingsreden: "testfixture",
    ...overrides,
  };
}

describe("A. schema/migratie", () => {
  it("pnl_bronmapping en pnl_mapping_wijziging_log bestaan na openOrCreateDatabase, en een tweede open is idempotent", () => {
    const tabellen = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pnl_bronmapping', 'pnl_mapping_wijziging_log')`).all() as { name: string }[];
    expect(tabellen.map((t) => t.name).sort()).toEqual(["pnl_bronmapping", "pnl_mapping_wijziging_log"]);

    // Tweede open op hetzelfde bestand mag geen fout geven en geen migratie opnieuw uitvoeren.
    db.close();
    const db2 = openOrCreateDatabase(dbPad);
    const versie = db2.prepare(`SELECT MAX(schema_version) AS v FROM begroting_schema_meta`).get() as { v: number };
    db2.close();
    db = openOrCreateDatabase(dbPad); // afterEach sluit dit exemplaar weer
    expect(versie.v).toBeGreaterThanOrEqual(24);
  });
});

describe("B. insert mapping + wijzigingslog atomair", () => {
  it("een geslaagde mutatie schrijft precies één mappingrij en precies één wijzigingslogregel, correct aan elkaar gekoppeld", () => {
    const resultaat = voegPnLBronmappingMutatieToe(db, mutatie());

    const regels = leesPnLBronmappingRegels(db, "023");
    expect(regels).toHaveLength(1);
    expect(regels[0]!.id).toBe(resultaat.nieuweMapping.id);
    expect(regels[0]!.economischeCategorie).toBe("RENTEKOSTEN");
    expect(regels[0]!.aangemaaktDoor).toBe(ACTOR);

    const log = leesPnLMappingWijzigingLog(db, "023");
    expect(log).toHaveLength(1);
    expect(log[0]!.nieuweMappingId).toBe(resultaat.nieuweMapping.id);
    expect(log[0]!.type).toBe("NIEUWE_MAPPING_VANAF_PERIODE");
    expect(log[0]!.gebruiker).toBe(ACTOR);
    expect(log[0]!.wijzigingsreden).toBe("testfixture");
  });
});

describe("C. ongeldige periode geweigerd", () => {
  it.each(["00", "13", "1", "AB"])("geldigVanafPeriode %s wordt geweigerd, geen rij geschreven", (periode) => {
    expect(() => voegPnLBronmappingMutatieToe(db, mutatie({ geldigVanafPeriode: periode }))).toThrow(/Ongeldige/);
    expect(leesPnLBronmappingRegels(db, "023")).toEqual([]);
    expect(leesPnLMappingWijzigingLog(db, "023")).toEqual([]);
  });

  it("geldigTotPeriode buiten 01-12 wordt geweigerd", () => {
    expect(() => voegPnLBronmappingMutatieToe(db, mutatie({ geldigTotBoekjaar: 2026, geldigTotPeriode: "13" }))).toThrow(/Ongeldige/);
    expect(leesPnLBronmappingRegels(db, "023")).toEqual([]);
  });
});

describe("D. ongeldig geldigheidsinterval geweigerd", () => {
  it("geldigTot gelijk aan geldigVanaf wordt geweigerd", () => {
    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ geldigVanafBoekjaar: 2025, geldigVanafPeriode: "06", geldigTotBoekjaar: 2025, geldigTotPeriode: "06" })),
    ).toThrow(/Ongeldig geldigheidsinterval/);
    expect(leesPnLBronmappingRegels(db, "023")).toEqual([]);
  });

  it("geldigTot vóór geldigVanaf wordt geweigerd", () => {
    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ geldigVanafBoekjaar: 2025, geldigVanafPeriode: "06", geldigTotBoekjaar: 2025, geldigTotPeriode: "01" })),
    ).toThrow(/Ongeldig geldigheidsinterval/);
    expect(leesPnLBronmappingRegels(db, "023")).toEqual([]);
  });
});

describe("E/G. cross-module GL+OGB geweigerd", () => {
  it("een OGB-mapping met een andere economischeModule dan een overlappende bestaande mapping van dezelfde GL wordt geweigerd, en laat geen spoor achter", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));

    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4602", economischeModule: "LEEGSTAND", economischeCategorie: "NUTS_LEEGSTAND" })),
    ).toThrow(/mag nooit van economische module wisselen/);

    // Geen half geschreven staat: nog steeds precies de ene, eerder geslaagde mapping/logregel.
    expect(leesPnLBronmappingRegels(db, "023")).toHaveLength(1);
    expect(leesPnLMappingWijzigingLog(db, "023")).toHaveLength(1);
  });

  it("hetzelfde conflict via een GL-default (ogbKostensoort: null) tegenover een bestaande GL+OGB-rij wordt ook geweigerd", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OVERIGE_ALGEMENE_KOSTEN", grootboekrekening: "4990" }));

    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: null, economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN", grootboekrekening: "4990" })),
    ).toThrow(/mag nooit van economische module wisselen/);
  });
});

describe("F. meerdere GL+OGB mappings zonder GL-default", () => {
  it("meerdere GL+OGB-mappings voor dezelfde GL mogen coexisteren zonder GL-default, zolang hun economischeModule onderling gelijk is (Rente-nuance)", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));
    voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4602", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));
    voegPnLBronmappingMutatieToe(db, mutatie({ ogbKostensoort: "4603", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));

    const regels = leesPnLBronmappingRegels(db, "023");
    expect(regels).toHaveLength(3);
    expect(regels.every((r) => r.economischeModule === "RENTE")).toBe(true);
    expect(regels.some((r) => r.ogbKostensoort === null)).toBe(false); // bewust geen GL-default aanwezig
  });
});

describe("H. historische correctie: live resolver kiest nieuwste kennis", () => {
  it("een HISTORISCHE_CORRECTIE met overlappende geldigheid en een latere aangemaaktOp wint bij live-resolutie", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ ogbKostensoort: "4990", grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OUDE_CATEGORIE", gewijzigdOp: new Date("2026-01-01T00:00:00.000Z") }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        ogbKostensoort: "4990",
        grootboekrekening: "4990",
        economischeModule: "ALGEMENE_KOSTEN",
        economischeCategorie: "NIEUWE_CATEGORIE",
        type: "HISTORISCHE_CORRECTIE",
        gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"),
        wijzigingsreden: "bleek vanaf het begin fout geclassificeerd",
      }),
    );

    const regels = leesPnLBronmappingRegels(db, "023");
    expect(regels).toHaveLength(2); // de oude rij is NIET aangepast/verwijderd

    const resultaat = resolveerPnLBronmapping(
      { bedrijfsnr: "023", grootboekrekening: "4990", ogbKostensoort: "4990", boekjaar: 2025, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z") },
      regels,
    );
    expect(resultaat).toEqual({
      status: "GEMAPT",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "NIEUWE_CATEGORIE",
      specificiteit: "GL_OGB",
      gebruikteMapping: expect.objectContaining({ economischeCategorie: "NIEUWE_CATEGORIE" }),
    });

    // Vóór de correctie was aangemaakt (systeemtijd-cutoff ervoor) ziet de oude categorie nog steeds.
    const resultaatEerder = resolveerPnLBronmapping(
      { bedrijfsnr: "023", grootboekrekening: "4990", ogbKostensoort: "4990", boekjaar: 2025, boekperiode: "06", opSysteemtijdstip: new Date("2026-06-01T00:00:00.000Z") },
      regels,
    );
    expect((resultaatEerder as { economischeCategorie: string }).economischeCategorie).toBe("OUDE_CATEGORIE");
  });
});

describe("I. nieuwe mapping vanaf periode houdt oude periode intact", () => {
  it("een NIEUWE_MAPPING_VANAF_PERIODE sluit de oude rij per de nieuwe geldigVanaf, en oude periodes blijven bij de oude categorie", () => {
    const eerste = voegPnLBronmappingMutatieToe(
      db,
      mutatie({ ogbKostensoort: "4990", grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OUDE_CATEGORIE", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        ogbKostensoort: "4990",
        grootboekrekening: "4990",
        economischeModule: "ALGEMENE_KOSTEN",
        economischeCategorie: "NIEUWE_CATEGORIE",
        geldigVanafBoekjaar: 2026,
        geldigVanafPeriode: "01",
        type: "NIEUWE_MAPPING_VANAF_PERIODE",
        vorigeMappingId: eerste.nieuweMapping.id,
        wijzigingsreden: "economische betekenis wijzigt echt vanaf 2026",
      }),
    );

    const regels = leesPnLBronmappingRegels(db, "023");
    const oudeRij = regels.find((r) => r.id === eerste.nieuweMapping.id)!;
    expect(oudeRij.geldigTotBoekjaar).toBe(2026);
    expect(oudeRij.geldigTotPeriode).toBe("01");
    expect(oudeRij.economischeCategorie).toBe("OUDE_CATEGORIE"); // ongewijzigd — alleen geldigTot is gezet

    const resultaat2025 = resolveerPnLBronmapping(
      { bedrijfsnr: "023", grootboekrekening: "4990", ogbKostensoort: "4990", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2027-01-01T00:00:00.000Z") },
      regels,
    );
    expect((resultaat2025 as { economischeCategorie: string }).economischeCategorie).toBe("OUDE_CATEGORIE");

    const resultaat2026 = resolveerPnLBronmapping(
      { bedrijfsnr: "023", grootboekrekening: "4990", ogbKostensoort: "4990", boekjaar: 2026, boekperiode: "01", opSysteemtijdstip: new Date("2027-01-01T00:00:00.000Z") },
      regels,
    );
    expect((resultaat2026 as { economischeCategorie: string }).economischeCategorie).toBe("NIEUWE_CATEGORIE");
  });
});

describe("J. rollback bij fout laat geen half wijzigingslog/mapping achter", () => {
  it("een mutatie die ná het sluiten van de vorige rij alsnog op de cross-module-check faalt, draait de sluiting volledig terug", () => {
    const rijDieGesloten = voegPnLBronmappingMutatieToe(
      db,
      mutatie({ ogbKostensoort: null, grootboekrekening: "6000", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OVERIGE_ALGEMENE_KOSTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ ogbKostensoort: "7001", grootboekrekening: "6000", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }),
    );
    expect(leesPnLBronmappingRegels(db, "023")).toHaveLength(2);
    expect(leesPnLMappingWijzigingLog(db, "023")).toHaveLength(2);

    // Deze mutatie sluit eerst rijDieGesloten (geen conflict daarmee zelf), maar de resterende open
    // OGB=7001-rij (ALGEMENE_KOSTEN) overlapt nog steeds met de nieuwe, bewust conflicterende RENTE-rij.
    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({
          ogbKostensoort: null,
          grootboekrekening: "6000",
          economischeModule: "RENTE",
          economischeCategorie: "RENTEKOSTEN",
          geldigVanafBoekjaar: 2026,
          geldigVanafPeriode: "01",
          type: "NIEUWE_MAPPING_VANAF_PERIODE",
          vorigeMappingId: rijDieGesloten.nieuweMapping.id,
        }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);

    const regelsNa = leesPnLBronmappingRegels(db, "023");
    expect(regelsNa).toHaveLength(2); // geen derde rij toegevoegd
    const teruggelezenGesloten = regelsNa.find((r) => r.id === rijDieGesloten.nieuweMapping.id)!;
    expect(teruggelezenGesloten.geldigTotBoekjaar).toBeNull(); // de sluiting is volledig teruggedraaid
    expect(teruggelezenGesloten.geldigTotPeriode).toBeNull();
    expect(leesPnLMappingWijzigingLog(db, "023")).toHaveLength(2); // geen derde logregel
  });
});

describe("K/L. Rente end-to-end via persistence (023 en 013)", () => {
  it("K. 023: mappings opgeslagen via de repository, teruggelezen, en via de ongewijzigde centrale keten -> Rentekosten exact 1.148.524,51", () => {
    const ogbCodes023 = [
      { ogbKostensoort: "4601", omschrijving: "Rente lening .962" },
      { ogbKostensoort: "4602", omschrijving: "Rente en Provisie ING R/C" },
      { ogbKostensoort: "4603", omschrijving: "Rente lening .586" },
      { ogbKostensoort: "4604", omschrijving: "Rente lening .500" },
      { ogbKostensoort: "4606", omschrijving: "rente lening 747" },
      { ogbKostensoort: "4620", omschrijving: "Overige rentes" },
    ];
    for (const { ogbKostensoort, omschrijving } of ogbCodes023) {
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({ bedrijfsnr: "023", grootboekrekening: "4600", ogbKostensoort, ogbKostensoortOmschrijving: omschrijving, economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }),
      );
    }

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "023");
    expect(mappingregels).toHaveLength(6);

    const boekingen: RenteRuweBoekingRegel[] = [
      { grootboekrekening: "4600", ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", saldo: new Decimal("522837.15") },
      { grootboekrekening: "4600", ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", saldo: new Decimal("49045.59") },
      { grootboekrekening: "4600", ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", saldo: new Decimal("104989.35") },
      { grootboekrekening: "4600", ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", saldo: new Decimal("66211.49") },
      { grootboekrekening: "4600", ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", saldo: new Decimal("357440.93") },
      { grootboekrekening: "4600", ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", saldo: new Decimal("48000") },
    ];

    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(
      { bedrijfsnr: "023", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("1148524.51");
  });

  it("L. 013: mappings opgeslagen via de repository, teruggelezen, en via de ongewijzigde centrale keten -> Rente opbrengsten exact -1.250,09", () => {
    const ogbCodes013 = [
      { ogbKostensoort: "4604", omschrijving: "Rente r/c" },
      { ogbKostensoort: "4621", omschrijving: "Rente opbrengst telerek" },
    ];
    for (const { ogbKostensoort, omschrijving } of ogbCodes013) {
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({
          bedrijfsnr: "013",
          grootboekrekening: "4620",
          ogbKostensoort,
          ogbKostensoortOmschrijving: omschrijving,
          economischeModule: "RENTE",
          economischeCategorie: "RENTE_OPBRENGSTEN",
          geldigVanafBoekjaar: 2024,
        }),
      );
    }

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "013");
    expect(mappingregels).toHaveLength(2);

    const boekingen: RenteRuweBoekingRegel[] = [
      { grootboekrekening: "4620", ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", saldo: new Decimal("-1215.67") },
      { grootboekrekening: "4620", ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", saldo: new Decimal("-34.42") },
    ];

    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(
      { bedrijfsnr: "013", boekjaar: 2024, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("-1250.09");
  });
});

describe("M. 070/GL4990 persistence proof", () => {
  it("GL4990-default -> ALGEMENE_KOSTEN, 4990/4992 -> MAKELAARSKOSTEN, 4990/4995 -> BANKKOSTEN, na terugleeslezen uit SQLite", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4990", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4990", ogbKostensoort: "4992", ogbKostensoortOmschrijving: "Makelaarskosten", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4990", ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN" }),
    );

    const mappingregels = leesPnLBronmappingRegels(db, "070");
    expect(mappingregels).toHaveLength(3);

    const invoerBasis = { bedrijfsnr: "070", grootboekrekening: "4990", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z") } as const;

    expect(resolveerPnLBronmapping({ ...invoerBasis, ogbKostensoort: "4992" }, mappingregels)).toEqual(
      expect.objectContaining({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN", specificiteit: "GL_OGB" }),
    );
    expect(resolveerPnLBronmapping({ ...invoerBasis, ogbKostensoort: "4995" }, mappingregels)).toEqual(
      expect.objectContaining({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN", specificiteit: "GL_OGB" }),
    );
    // Onbekende/afwezige OGB op GL4990 valt terug op de GL-default.
    expect(resolveerPnLBronmapping({ ...invoerBasis, ogbKostensoort: "4991" }, mappingregels)).toEqual(
      expect.objectContaining({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" }),
    );
    expect(resolveerPnLBronmapping({ ...invoerBasis, ogbKostensoort: null }, mappingregels)).toEqual(
      expect.objectContaining({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" }),
    );
  });
});

/**
 * FASE M4b (2026-09-15) — GL-economisch-domein hard afdwingen. Sluit de
 * loophole uit M4: een `NIEUWE_MAPPING_VANAF_PERIODE` mocht een GL, na het
 * sluiten van de vorige rij, alsnog naar een ANDERE `economischeModule` laten
 * springen (bv. GL4600 RENTE → vanaf periode X LEEGSTAND). Zie
 * `pnlBronmappingRepository.ts`'s moduledoc voor de volledige motivatie.
 */
describe("M4b — GL-economisch-domein-invariant", () => {
  it("A. de eerste mapping op een nieuwe GL bepaalt het economische domein (geen fout, niets om tegen te vergelijken)", () => {
    const resultaat = voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "8000", ogbKostensoort: "8001", economischeModule: "VERZEKERINGEN", economischeCategorie: "PREMIE" }));
    expect(resultaat.nieuweMapping.economischeModule).toBe("VERZEKERINGEN");
  });

  it("B. een tweede OGB op dezelfde GL met dezelfde economischeModule is toegestaan", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "8000", ogbKostensoort: "8001", economischeModule: "VERZEKERINGEN", economischeCategorie: "PREMIE" }));
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "8000", ogbKostensoort: "8002", economischeModule: "VERZEKERINGEN", economischeCategorie: "EIGEN_RISICO" }));

    const regels = leesPnLBronmappingRegels(db, "023").filter((r) => r.grootboekrekening === "8000");
    expect(regels).toHaveLength(2);
    expect(regels.every((r) => r.economischeModule === "VERZEKERINGEN")).toBe(true);
  });

  it("C. een tweede OGB op dezelfde GL met een andere economischeModule wordt geweigerd, ongeacht overlap", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "8000", ogbKostensoort: "8001", economischeModule: "VERZEKERINGEN", economischeCategorie: "PREMIE" }));

    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "8000", ogbKostensoort: "8002", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "OZB" })),
    ).toThrow(/mag nooit van economische module wisselen/);
    expect(leesPnLBronmappingRegels(db, "023").filter((r) => r.grootboekrekening === "8000")).toHaveLength(1);
  });

  it("D. exact de M4-loophole: NIEUWE_MAPPING_VANAF_PERIODE die de GL na sluiting van de vorige rij naar een andere module wil laten springen, wordt geweigerd", () => {
    const eerste = voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }));

    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({
          grootboekrekening: "4600",
          ogbKostensoort: "4601",
          economischeModule: "LEEGSTAND",
          economischeCategorie: "NUTS_LEEGSTAND",
          geldigVanafBoekjaar: 2026,
          geldigVanafPeriode: "01",
          type: "NIEUWE_MAPPING_VANAF_PERIODE",
          vorigeMappingId: eerste.nieuweMapping.id,
          wijzigingsreden: "poging om GL4600 vanaf 2026 als LEEGSTAND te classificeren",
        }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);

    // De vorige rij is NIET gesloten (volledige rollback) — GL4600 blijft onveranderd RENTE, open-ended.
    const regels = leesPnLBronmappingRegels(db, "023").filter((r) => r.grootboekrekening === "4600");
    expect(regels).toHaveLength(1);
    expect(regels[0]!.geldigTotBoekjaar).toBeNull();
    expect(regels[0]!.geldigTotPeriode).toBeNull();
  });

  it("E. een historische correctie met een andere economischeModule op dezelfde GL wordt geweigerd", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));

    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({
          grootboekrekening: "4600",
          ogbKostensoort: "4601",
          economischeModule: "ALGEMENE_KOSTEN",
          economischeCategorie: "OVERIGE_ALGEMENE_KOSTEN",
          type: "HISTORISCHE_CORRECTIE",
          wijzigingsreden: "poging om GL4600 met terugwerkende kracht als Algemene Kosten te classificeren",
        }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);
    expect(leesPnLBronmappingRegels(db, "023").filter((r) => r.grootboekrekening === "4600")).toHaveLength(1);
  });

  it("F. GL zonder GL-default: meerdere OGB's met dezelfde economischeModule blijven toegestaan (Rente-nuance, ongewijzigd)", () => {
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));
    voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4602", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }));

    const regels = leesPnLBronmappingRegels(db, "023").filter((r) => r.grootboekrekening === "4600");
    expect(regels).toHaveLength(2);
    expect(regels.some((r) => r.ogbKostensoort === null)).toBe(false);
  });

  it("G. een reeds afgesloten historische rij blijft het economische domein van de GL bepalen", () => {
    const eerste = voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }));
    // Legitieme NIEUWE_MAPPING_VANAF_PERIODE: zelfde module (RENTE), alleen de categorie verandert — dit sluit de eerste rij.
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        grootboekrekening: "4600",
        ogbKostensoort: "4601",
        economischeModule: "RENTE",
        economischeCategorie: "RENTE_OPBRENGSTEN",
        geldigVanafBoekjaar: 2026,
        geldigVanafPeriode: "01",
        type: "NIEUWE_MAPPING_VANAF_PERIODE",
        vorigeMappingId: eerste.nieuweMapping.id,
      }),
    );
    const gesloten = leesPnLBronmappingRegels(db, "023").find((r) => r.id === eerste.nieuweMapping.id)!;
    expect(gesloten.geldigTotBoekjaar).toBe(2026); // bevestigt dat de rij daadwerkelijk gesloten is

    // Een DERDE mutatie op dezelfde GL met een andere module moet nog steeds worden geweigerd — de
    // inmiddels gesloten eerste rij (en de tweede) blijven het domein (RENTE) bepalen.
    expect(() =>
      voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4699", economischeModule: "VERZEKERINGEN", economischeCategorie: "PREMIE", geldigVanafBoekjaar: 2027, geldigVanafPeriode: "01" })),
    ).toThrow(/mag nooit van economische module wisselen/);
  });

  it("H. rollback is volledig bij een moduleconflict: geen mapping, geen logregel, en een eventueel gesloten interval wordt teruggedraaid", () => {
    const eerste = voegPnLBronmappingMutatieToe(db, mutatie({ grootboekrekening: "4600", ogbKostensoort: "4601", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" }));
    const aantalRegelsVoor = leesPnLBronmappingRegels(db, "023").length;
    const aantalLogregelsVoor = leesPnLMappingWijzigingLog(db, "023").length;

    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({
          grootboekrekening: "4600",
          ogbKostensoort: "4601",
          economischeModule: "LEEGSTAND",
          economischeCategorie: "NUTS_LEEGSTAND",
          geldigVanafBoekjaar: 2026,
          geldigVanafPeriode: "01",
          type: "NIEUWE_MAPPING_VANAF_PERIODE",
          vorigeMappingId: eerste.nieuweMapping.id,
        }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);

    expect(leesPnLBronmappingRegels(db, "023")).toHaveLength(aantalRegelsVoor);
    expect(leesPnLMappingWijzigingLog(db, "023")).toHaveLength(aantalLogregelsVoor);
    const nogSteedsOpen = leesPnLBronmappingRegels(db, "023").find((r) => r.id === eerste.nieuweMapping.id)!;
    expect(nogSteedsOpen.geldigTotBoekjaar).toBeNull();
    expect(nogSteedsOpen.geldigTotPeriode).toBeNull();
  });
});
