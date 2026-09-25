import { mkdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase, voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "@bvc/begroting-data";
import type { PnLEconomischeModule } from "@bvc/reporting";
import { genereerPnLPeriode } from "./genereerPnLPeriode.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, pnlBronmappingDatabasePad } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

/**
 * DELTA BUILD (2026-09-18) — "Pure P&L → Worker + Renderer": bewijst het
 * NIEUWE risico van deze Delta Build op Worker-niveau (criteria A/D): dat
 * `genereerPnLPeriode` — via een ECHT xlsx-bronbestand (`ExcelBronAdapter`)
 * en een ECHTE, tijdelijke `@bvc/begroting-data`-SQLite-database
 * (`voegPnLBronmappingMutatieToe`/`leesPnLBronmappingRegels`, de EERSTE
 * productie-aanroep van die repository vanuit `apps/worker`) — daadwerkelijk
 * de acht bestaande productieketens + `berekenPnLBoom` aanroept en de
 * reeds door GAT-013 bronbewezen 070-H1-uitkomst reproduceert. De
 * boekingsbedragen hieronder zijn DEZELFDE, reeds bronbewezen getallen als
 * `gat013_070Fixtures.ts` (`@bvc/reporting`) — hier opnieuw uitgedrukt als
 * RUWE Excel-rijen (debet/credit i.p.v. kant-en-klaar saldo) omdat dat het
 * brontype is dat déze laag daadwerkelijk leest, GEEN nieuw bronbewijs.
 *
 * GEEN HERBEWIJS VAN DE FINANCIËLE LOGICA ZELF (die staat in GAT-013 +
 * `pnlPeriodeOrchestratie.test.ts`, ongewijzigd) — uitsluitend het
 * I/O-/wiring-risico van DEZE laag.
 */

let root: string;
const ADMINISTRATIE_ID = "070_rooisezoom";
const BEDRIJFSNR = "070";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-pnl-periode-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMINISTRATIE_ID), { recursive: true });
  schrijfAdministratieConfig(root, ADMINISTRATIE_ID, nieuweAdministratieConfig(BEDRIJFSNR, "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function boekingRij(gl: string, saldo: number, ogb: string | null = null, ogbOms: string | null = null, complex: string | null = null, periode = "03"): Record<string, unknown> {
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: periode,
    Boeking_Grootboeknr: gl,
    Boeking_OGB_Kostensoort: ogb,
    Boeking_OGB_Kostensoort_Omschr: ogbOms,
    Boeking_Complexnr: complex,
    // debet/credit zo gekozen dat debet - credit (CAL-FIN-001) exact het bronbewezen saldo oplevert.
    Boeking_Bedrag_Debet: saldo >= 0 ? saldo : 0,
    Boeking_Bedrag_Credit: saldo >= 0 ? 0 : -saldo,
  };
}

function voegMapping(db: ReturnType<typeof openOrCreateDatabase>, overrides: Partial<PnLBronmappingMutatieInvoer> & { grootboekrekening: string; economischeModule: PnLEconomischeModule; economischeCategorie: string }): void {
  voegPnLBronmappingMutatieToe(db, {
    bedrijfsnr: BEDRIJFSNR,
    grootboekOmschrijving: null,
    ogbKostensoort: null,
    ogbKostensoortOmschrijving: null,
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-09-18T00:00:00.000Z"),
    gebruiker: "test",
    wijzigingsreden: "Delta Build test-seed",
    ...overrides,
  });
}

describe("genereerPnLPeriode — productie-integratie (echte xlsx-bron + echte PnL-bronmapping-SQLite)", () => {
  it("A/D: reproduceert de door GAT-013 bronbewezen H1-070-EBITDA via de volledige productieketen (xlsx -> mapping-DB -> acht adapters -> berekenPnLBoom -> HTML)", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      // Huur (GL8800/8801/8805, H1-totalen exact zoals GAT-013 bronbewezen).
      boekingRij("8800", -268456.65),
      boekingRij("8801", -85046.16),
      boekingRij("8805", 11768),
      // Beheer (GL4000, H1-totaal 6445.64 exact zoals GAT-013 bronbewezen).
      boekingRij("4000", 6445.64),
      // Onderhoud (GL4300/4330/4340).
      boekingRij("4300", 320.05, "4313", "Onderhoud"),
      boekingRij("4330", 2985.5, "4330", "Onderhoud groen"),
      boekingRij("4340", 628.09, "4340", "Onderhoud installaties"),
      // Verzekeringen (GL4130/OGB4131).
      boekingRij("4130", 5180.75, "4131", "Brand-/opstalverzekering"),
      // Gemeentelijke lasten (GL4700+4710/OGB4701).
      boekingRij("4700", 9324.19, "4701", "OZB"),
      boekingRij("4710", 5022.71, "4710", "Gemeentelijke heffingen"),
      // Algemene kosten (GL4990).
      boekingRij("4990", 449.14, "4995", "Bankkosten"),
      // Servicekosten Eigenaar (GL4350/OGB4319).
      boekingRij("4350", 199.08, "4319", "Servicekosten leegstand"),
    ]);

    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    try {
      voegMapping(mappingDb, { grootboekrekening: "8800", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_BELAST" });
      voegMapping(mappingDb, { grootboekrekening: "8801", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_ONBELAST" });
      voegMapping(mappingDb, { grootboekrekening: "8805", economischeModule: "HUUR", economischeCategorie: "VERLEENDE_HUURKORTING" });
      voegMapping(mappingDb, { grootboekrekening: "4000", economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" });
      voegMapping(mappingDb, { grootboekrekening: "4300", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" });
      voegMapping(mappingDb, { grootboekrekening: "4330", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_TERREIN" });
      voegMapping(mappingDb, { grootboekrekening: "4340", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_INSTALLATIES" });
      voegMapping(mappingDb, { grootboekrekening: "4130", ogbKostensoort: "4131", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" });
      voegMapping(mappingDb, { grootboekrekening: "4700", ogbKostensoort: "4701", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" });
      voegMapping(mappingDb, { grootboekrekening: "4710", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" });
      voegMapping(mappingDb, { grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" });
      voegMapping(mappingDb, { grootboekrekening: "4990", ogbKostensoort: "4995", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN" });
      voegMapping(mappingDb, { grootboekrekening: "4350", ogbKostensoort: "4319", economischeModule: "SERVICEKOSTEN_EIGENAAR", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" });
    } finally {
      mappingDb.close();
    }

    const resultaat = genereerPnLPeriode(root, ADMINISTRATIE_ID, { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    // A: bewijst dat de Worker daadwerkelijk de acht productieketens + berekenPnLBoom heeft aangeroepen (echte, niet-triviale bedragen).
    expect(resultaat.resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("341734.81");
    expect(resultaat.resultaat.totaalKosten.besteWetenSom.toString()).toBe("30555.15");
    // D: reproduceert exact de door GAT-013 bronbewezen H1-EBITDA.
    expect(resultaat.resultaat.ebitda.bedrag.toString()).toBe("311179.66");
    expect(resultaat.resultaat.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("311180");
    // Vervolgtranche 6 (Unknown != zero): de bedragen blijven exact, maar posten zonder bewezen mapping in DEZE mapping-DB (Management, Accountant,
    // Juridisch en — in dit fixture bewust niet gemapt — Makelaar/taxatie) zijn ONBEKEND in plaats van een bevestigde €0; EBITDA is daardoor ONVOLLEDIG.
    const ebitdaVolledigheid = resultaat.resultaat.ebitda.volledigheid;
    expect(ebitdaVolledigheid.status).toBe("ONVOLLEDIG");
    expect(ebitdaVolledigheid.status === "ONVOLLEDIG" ? ebitdaVolledigheid.ontbrekend.map((o) => o.regelSleutel).sort() : []).toEqual(["ACCOUNTANT", "JURIDISCHE_KOSTEN", "MAKELAARSKOSTEN", "MANAGEMENTVERGOEDING"]);
    expect(resultaat.nietMeegenomen).toEqual([]);

    // Renderer: het geschreven HTML-rapport bevat de EBITDA-uitkomst, geen eigen herberekening.
    const geschrevenHtml = readFileSync(resultaat.pad, "utf-8");
    expect(geschrevenHtml).toBe(resultaat.html);
    expect(geschrevenHtml).toContain("Winst- en verliesrekening");
    expect(geschrevenHtml).toContain("EBITDA");
  });

  it("routeert boekingen buiten de acht productieketens (niet gemapt) zichtbaar naar nietMeegenomen, nooit stilzwijgend weggelaten", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("9999", 42)]);
    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    mappingDb.close();

    const resultaat = genereerPnLPeriode(root, ADMINISTRATIE_ID, { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.nietMeegenomen).toHaveLength(1);
    expect(resultaat.nietMeegenomen[0]!.economischeModule).toBeNull();
    expect(resultaat.nietMeegenomen[0]!.totaal.toString()).toBe("42");
    expect(resultaat.nietMeegenomen[0]!.aantalBoekingen).toBe(1);
    expect(resultaat.html).toContain("Niet meegenomen in dit rapport");
  });

  it("faalt hard met een duidelijke fout wanneer het boekingen-bronbestand ontbreekt (geen stilzwijgende lege P&L)", () => {
    expect(() => genereerPnLPeriode(root, ADMINISTRATIE_ID, { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Boekingen-bronbestand niet gevonden/);
  });
});
