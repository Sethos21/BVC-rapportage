import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  berekenWerkelijkGeplandeVerkoopViaCentraleMapping,
  berekenWerkelijkGemeentelijkeLastenViaCentraleMapping,
  berekenWerkelijkLeegstandViaCentraleMapping,
  berekenWerkelijkOnderhoudViaCentraleMapping,
  berekenWerkelijkRenteViaCentraleMapping,
  berekenWerkelijkVerzekeringenViaCentraleMapping,
  resolveerPnLBronmapping,
  type GemeentelijkeLastenRuweBoekingRegel,
  type GeplandeVerkoopRuweBoekingRegel,
  type LeegstandRuweBoekingRegel,
  type OnderhoudRuweBoekingRegel,
  type PnLBronmappingRegel,
  type RenteRuweBoekingRegel,
  type VerzekeringRuweBoekingRegel,
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

/**
 * FASE M5 (2026-09-15) — Leegstand (OB-031) end-to-end via de bestaande
 * M4/M4b-persistence: mapping opslaan → teruglezen → centrale resolver →
 * de ongewijzigde `berekenWerkelijkLeegstand` (via M5's
 * `berekenWerkelijkLeegstandViaCentraleMapping`). Bewezen bronproef:
 * 070_Rooise_Zoom, GL4350/OGB4319 → SERVICEKOSTEN_LEEGSTAND, 6 boekingen,
 * complex 003, totaal €1.354,10. Geen tweede/module-specifieke persistence —
 * dezelfde generieke `voegPnLBronmappingMutatieToe`/`leesPnLBronmappingRegels`
 * als Rente hierboven.
 */
describe("M5. Leegstand end-to-end via persistence (070 GL4350/OGB4319)", () => {
  it("B/D. mapping opgeslagen via de repository, teruggelezen, en via de ongewijzigde centrale keten -> Servicekosten leegstand exact €1.354,10", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "070",
        grootboekrekening: "4350",
        ogbKostensoort: "4319",
        ogbKostensoortOmschrijving: "Servicekosten leegstand",
        economischeModule: "LEEGSTAND",
        economischeCategorie: "SERVICEKOSTEN_LEEGSTAND",
      }),
    );

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "070");
    expect(mappingregels).toHaveLength(1); // geen fictieve Nuts-/Overige-mapping toegevoegd

    const boekingen: LeegstandRuweBoekingRegel[] = [
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal(1000) },
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal(1000) },
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal(1000) },
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal("97.53") },
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal("-1283.17") },
      { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal("-460.26") },
    ];

    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.categorieTotaal.toString()).toBe("0");
  });

  it("M. GL-module-invariant (M4b) geldt onverkort voor Leegstand: GL4350 mag na deze mapping nooit meer een andere module krijgen", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", economischeModule: "LEEGSTAND", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" }),
    );

    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({ bedrijfsnr: "070", grootboekrekening: "4350", ogbKostensoort: "4998", ogbKostensoortOmschrijving: "fictief Nuts-OGB", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OVERIGE_ALGEMENE_KOSTEN" }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);

    expect(leesPnLBronmappingRegels(db, "070")).toHaveLength(1);
  });
});

/**
 * FASE M6a (2026-09-15) — Geplande Verkoop (OB-039) end-to-end via de
 * bestaande M4/M4b-persistence: mapping opslaan → teruglezen → centrale
 * resolver (via de generieke `classificeerBoekingenViaPnLMapping`) → de
 * ongewijzigde `berekenWerkelijkGeplandeVerkoop`. Bewezen bronproef:
 * 023_Malcon_Beheer_BV, boekjaar 2026 periode 04 (Hoofdstraat/Driebergen).
 * Geen tweede/module-specifieke persistence — dezelfde generieke
 * `voegPnLBronmappingMutatieToe`/`leesPnLBronmappingRegels` als Rente/
 * Leegstand hierboven.
 */
describe("M6a. Geplande Verkoop end-to-end via persistence (023, GL08830-default + GL00166/OGB3010)", () => {
  it("H. mappings opgeslagen via de repository, teruggelezen, en via de ongewijzigde centrale keten -> economisch identiek aan de echte 023-bronproef", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "023",
        grootboekrekening: "08830",
        ogbKostensoort: null,
        ogbKostensoortOmschrijving: null,
        economischeModule: "VERKOOP",
        economischeCategorie: "VERKOOPOPBRENGST",
        geldigVanafBoekjaar: 2026,
        geldigVanafPeriode: "01",
      }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "023",
        grootboekrekening: "00166",
        ogbKostensoort: "3010",
        ogbKostensoortOmschrijving: "afwaardering ASW",
        economischeModule: "VERKOOP",
        economischeCategorie: "BOEKWAARDE_AFBOEKING",
        geldigVanafBoekjaar: 2026,
        geldigVanafPeriode: "01",
      }),
    );

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "023");
    expect(mappingregels).toHaveLength(2); // geen fictieve GL00167-mapping toegevoegd

    const boekingen: GeplandeVerkoopRuweBoekingRegel[] = [
      { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(-785000) }, // Hoofdstraat-opbrengst
      { grootboekrekening: "00166", grootboekOmschrijving: null, ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", saldo: new Decimal(-535000) }, // Driebergen-boekwaarde ASW
      { grootboekrekening: "00167", grootboekOmschrijving: null, ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(-100000) }, // Driebergen-boekwaarde HW, nooit bewezen
      { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(635000) }, // Driebergen-reclassificatie op 08830
    ];

    const { werkelijk, nietGemapt } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(
      { bedrijfsnr: "023", boekjaar: 2026, boekperiode: "04", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([{ grootboekrekening: "00167", ogbKostensoort: null }]);
    expect(werkelijk.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("-150000");
    expect(werkelijk.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("-535000");
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("-100000");
  });

  it("de M4b GL-module-invariant geldt onverkort voor Verkoop-GL's: GL08830 mag na deze mapping nooit meer een andere module krijgen", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "023", grootboekrekening: "08830", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "VERKOOP", economischeCategorie: "VERKOOPOPBRENGST" }),
    );

    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({ bedrijfsnr: "023", grootboekrekening: "08830", ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);

    expect(leesPnLBronmappingRegels(db, "023")).toHaveLength(1);
  });
});

/**
 * FASE M7 (2026-09-15) — Verzekeringen/Gemeentelijke Lasten/Onderhoud
 * end-to-end via de bestaande M4/M4b-persistence: mapping opslaan →
 * teruglezen → centrale resolver/generieke helper → de nieuwe, pure
 * Werkelijk-calculators. Geen module-specifieke persistence — dezelfde
 * generieke `voegPnLBronmappingMutatieToe`/`leesPnLBronmappingRegels` als
 * Rente/Leegstand/Geplande Verkoop hierboven. Bronmapping is bronbewezen
 * (aangeleverd in de M7-opdracht); er is GEEN bestaand, uit een echte
 * administratie geëxtraheerd eurobedrag beschikbaar voor deze GL's — de
 * testbedragen hieronder zijn expliciete testfixtures (zie ook de
 * moduledocs van `verzekeringCentraleMapping.ts`/
 * `gemeentelijkeLastenCentraleMapping.ts`/`onderhoudCentraleMapping.ts`).
 */
describe("M7. Verzekeringen end-to-end via persistence (070, GL4130/OGB4131)", () => {
  it("mapping opgeslagen via de repository, teruggelezen, en via de centrale keten -> Brand-/opstalverzekering correct opgeteld", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "070",
        grootboekrekening: "4130",
        ogbKostensoort: "4131",
        ogbKostensoortOmschrijving: "Brand-/opstalverzekering",
        economischeModule: "VERZEKERINGEN",
        economischeCategorie: "BRAND_OPSTALVERZEKERING",
      }),
    );

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "070");
    expect(mappingregels).toHaveLength(1);

    const boekingen: VerzekeringRuweBoekingRegel[] = [
      { grootboekrekening: "4130", ogbKostensoort: "4131", ogbKostensoortOmschrijving: "Brand-/opstalverzekering", complexnummer: "003", saldo: new Decimal("1150.75") },
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkVerzekeringenViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!.categorieTotaal.toString()).toBe("1150.75");
  });
});

describe("M7. Gemeentelijke Lasten end-to-end via persistence (070, GL4700/OGB4701 + GL4710-default)", () => {
  it("mappings opgeslagen via de repository, teruggelezen, en via de centrale keten -> één gecombineerde categorie, geen fictieve splitsing", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "070",
        grootboekrekening: "4700",
        ogbKostensoort: "4701",
        ogbKostensoortOmschrijving: "OZB",
        economischeModule: "GEMEENTELIJKE_LASTEN",
        economischeCategorie: "GEMEENTELIJKE_LASTEN",
      }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({
        bedrijfsnr: "070",
        grootboekrekening: "4710",
        ogbKostensoort: null,
        ogbKostensoortOmschrijving: null,
        economischeModule: "GEMEENTELIJKE_LASTEN",
        economischeCategorie: "GEMEENTELIJKE_LASTEN",
      }),
    );

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "070");
    expect(mappingregels).toHaveLength(2);

    const boekingen: GemeentelijkeLastenRuweBoekingRegel[] = [
      { grootboekrekening: "4700", ogbKostensoort: "4701", ogbKostensoortOmschrijving: "OZB", complexnummer: "003", saldo: new Decimal("900") },
      { grootboekrekening: "4710", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal("175.50") },
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie).toHaveLength(1);
    expect(werkelijk.perCategorie[0]!.categorieTotaal.toString()).toBe("1075.5");
  });
});

describe("M7. Onderhoud end-to-end via persistence (070, GL4300/GL4330/GL4340)", () => {
  it("mappings opgeslagen via de repository, teruggelezen, en via de centrale keten -> drie strikt gescheiden categorieën", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4300", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4330", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_TERREIN" }),
    );
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4340", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_INSTALLATIES" }),
    );

    const mappingregels: readonly PnLBronmappingRegel[] = leesPnLBronmappingRegels(db, "070");
    expect(mappingregels).toHaveLength(3);

    const boekingen: OnderhoudRuweBoekingRegel[] = [
      { grootboekrekening: "4300", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal("600") },
      { grootboekrekening: "4330", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal("150") },
      { grootboekrekening: "4340", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal("225") },
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkOnderhoudViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      boekingen,
      mappingregels,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal.toString()).toBe("600");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_TERREIN")!.categorieTotaal.toString()).toBe("150");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_INSTALLATIES")!.categorieTotaal.toString()).toBe("225");
    expect(werkelijk.moduleTotaal.toString()).toBe("975");
  });

  it("M4b GL-module-invariant geldt onverkort: GL4300 mag na deze mapping nooit meer een andere module krijgen", () => {
    voegPnLBronmappingMutatieToe(
      db,
      mutatie({ bedrijfsnr: "070", grootboekrekening: "4300", ogbKostensoort: null, ogbKostensoortOmschrijving: null, economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" }),
    );
    expect(() =>
      voegPnLBronmappingMutatieToe(
        db,
        mutatie({ bedrijfsnr: "070", grootboekrekening: "4300", ogbKostensoort: "9999", ogbKostensoortOmschrijving: "fictief", economischeModule: "LEEGSTAND", economischeCategorie: "OVERIGE_LEEGSTANDSKOSTEN" }),
      ),
    ).toThrow(/mag nooit van economische module wisselen/);
    expect(leesPnLBronmappingRegels(db, "070")).toHaveLength(1);
  });
});
