import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase, voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "@bvc/begroting-data";
import { renderBalansPeriodeBody, renderHuurdersoverzichtBody, type PnLEconomischeModule } from "@bvc/reporting";
import { genereerSamengesteldRapport } from "./genereerSamengesteldRapport.js";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
import { genereerHuurdersoverzicht } from "./genereerHuurdersoverzicht.js";
import { rebuildCache } from "./rebuildCache.js";
import { leesAdministratieConfig, nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir, pnlBronmappingDatabasePad } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

/**
 * DELTA BUILD (2026-09-18) — "Selecteerbare samengestelde rapportgenerator
 * V1": bewijst uitsluitend het NIEUWE integratierisico van deze build
 * (selectie/orchestratie/documentstructuur/statussen) — GEEN herbewijs van
 * de onderliggende, reeds bewezen rekenlogica (Pure P&L Engine/GAT-013,
 * Balanscalculator, Huurdersoverzicht-calculator blijven ongewijzigd en
 * hebben hun eigen, ongewijzigde tests).
 *
 * ECHTE 070-DATA: de P&L-boekingen zijn DEZELFDE, reeds bronbewezen 070
 * H1-2026-cijfers als `genereerPnLPeriode.test.ts` (herleid naar exact
 * €341.734,81 / €30.555,15 / €311.179,66). Het Huurdersoverzicht gebruikt
 * één ECHT 070-contract (0000000028, "Fruitcake BV") uit de bestaande,
 * reeds bronbewezen dataset in `genereerHuurdersoverzicht.test.ts` — hier
 * bewust NIET alle 12 contracten herhaald (dat blijft die test se eigen,
 * ongewijzigde bewijslast), uitsluitend genoeg om "identiek aan standalone"
 * te kunnen bewijzen. De Balans-fixture volgt exact hetzelfde, reeds
 * geaccepteerde patroon als `genereerBalansPeriode.test.ts` (schematische
 * bedragen op de echte 070-administratie-identiteit) — geen nieuw
 * testpatroon.
 */

let root: string;
const ADMINISTRATIE_ID = "070_rooisezoom";
const BEDRIJFSNR = "070";

let volgendVolgnr = 1;

function pnlBoekingRij(gl: string, saldo: number, ogb: string | null = null, ogbOms: string | null = null, complex: string | null = null, periode = "03"): Record<string, unknown> {
  const volgnr = String(volgendVolgnr++).padStart(3, "0");
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: periode,
    Boeking_Grootboeknr: gl,
    Boeking_OGB_Kostensoort: ogb,
    Boeking_OGB_Kostensoort_Omschr: ogbOms,
    Boeking_Complexnr: complex,
    Boeking_Bedrag_Debet: saldo >= 0 ? saldo : 0,
    Boeking_Bedrag_Credit: saldo >= 0 ? 0 : -saldo,
    // Balans/rebuildCache-vereiste velden die de kale, ongebruikte kolommen invullen (zelfde als andere worker-fixtures) — elk uniek (dagboeknr, boekstuknr, volgnr) per rij.
    Boekstuk_Sleutel: `070300${volgnr}`,
    Boeking_Dagboeknr: "30",
    Boeking_Boekstuknr: volgnr,
    Boeking_Volgnr: "1",
    Boeking_Boekdatum: `01-${periode}-2026`,
    Boeking_Omschrijving: "test",
  };
}

/** Dezelfde, reeds bronbewezen 070 H1-2026-cijfers als genereerPnLPeriode.test.ts (zie dat bestand voor de herkomst per module). */
function schrijfEchteH1PnLBoekingen(): Record<string, unknown>[] {
  return [
    pnlBoekingRij("8800", -268456.65),
    pnlBoekingRij("8801", -85046.16),
    pnlBoekingRij("8805", 11768),
    pnlBoekingRij("4000", 6445.64),
    pnlBoekingRij("4300", 320.05, "4313", "Onderhoud"),
    pnlBoekingRij("4330", 2985.5, "4330", "Onderhoud groen"),
    pnlBoekingRij("4340", 628.09, "4340", "Onderhoud installaties"),
    pnlBoekingRij("4130", 5180.75, "4131", "Brand-/opstalverzekering"),
    pnlBoekingRij("4700", 9324.19, "4701", "OZB"),
    pnlBoekingRij("4710", 5022.71, "4710", "Gemeentelijke heffingen"),
    pnlBoekingRij("4990", 449.14, "4995", "Bankkosten"),
    pnlBoekingRij("4350", 199.08, "4319", "Servicekosten leegstand"),
  ];
}

function voegPnLMapping(db: ReturnType<typeof openOrCreateDatabase>, overrides: Partial<PnLBronmappingMutatieInvoer> & { grootboekrekening: string; economischeModule: PnLEconomischeModule; economischeCategorie: string }): void {
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

function zaaiPnLMapping(): void {
  const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
  try {
    voegPnLMapping(mappingDb, { grootboekrekening: "8800", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_BELAST" });
    voegPnLMapping(mappingDb, { grootboekrekening: "8801", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_ONBELAST" });
    voegPnLMapping(mappingDb, { grootboekrekening: "8805", economischeModule: "HUUR", economischeCategorie: "VERLEENDE_HUURKORTING" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4000", economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4300", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4330", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_TERREIN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4340", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_INSTALLATIES" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4130", ogbKostensoort: "4131", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4700", ogbKostensoort: "4701", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4710", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4990", ogbKostensoort: "4995", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN" });
    voegPnLMapping(mappingDb, { grootboekrekening: "4350", ogbKostensoort: "4319", economischeModule: "SERVICEKOSTEN_EIGENAAR", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" });
  } finally {
    mappingDb.close();
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-rapport-samengesteld-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMINISTRATIE_ID), { recursive: true });
  schrijfAdministratieConfig(root, ADMINISTRATIE_ID, nieuweAdministratieConfig(BEDRIJFSNR, "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), schrijfEchteH1PnLBoekingen());
  // Balans: zelfde schematische aanpak als genereerBalansPeriode.test.ts — beginbalans op GL1010, geen extra 2026-mutaties op die rekening (voorkomt vermenging met de echte P&L-GL's hierboven).
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    { Bedrijfsnr: BEDRIJFSNR, Jaar: 2026, Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Saldo_debet: 0, Saldo_credit: 0, Eindsaldo: 0, Rekening_omschrijving: "Bank", Balans_vw: "Balans" },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
  // Huurdersoverzicht: één ECHT 070-contract (0000000028, "Fruitcake BV"), zie genereerHuurdersoverzicht.test.ts.
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    {
      Bedrijfsnr: BEDRIJFSNR, Contract: "0000000028", Complexnummer: "002", Unitnummer: "0001", Huurdernummer: "00000021",
      Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2029", Expiratie_Opzegdatum: "31-12-2028", Expiratie_Aantal_per_optie: 12, Expiratie_huidige: "Ja",
      Huurder_Naam_1: "Fruitcake BV", Waarborgsom: "0", Complexomschrijving: "Villa II",
      Verhoging_datum: "01-07-2027", Verhoging_Jaar_vlgd: "2027", Verhoging_Periode_vlgd: "07",
      Verhoging_percentage: "0", Verhoging_methode: "Prijsindex", Omschrijving_indextabel: "CPI 2025 = 100",
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: BEDRIJFSNR, Contractnummer: "0000000028", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "002",
      Rapportage_datum: "31-07-2026", Prolongatie_bedrag_jaar: "37318.8", Korting_bedrag_jaar: "0",
      Service_voorschot_jaar: "21600", Gehuurd_oppervlak: "320",
      Contract_expiratiedatum: "31-12-2029", Contract_opzegdatum: "31-12-2028",
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contract_verhogingen.xlsx"), [
    { Bedrijfsnr: BEDRIJFSNR, Contract: "0000000028", Jaar: "2026", Periode: "07", Status: "Verwerkt", Toekomstige_verhoging: "Nee", Bedrag_oud_VS_01: "3028.6", Bedrag_Nieuw_VS_01: "3109.9" },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  // Uitsluitend GL1010 gemapt (BALANS/ACTIVA) — de echte P&L-GL's hierboven zijn in het OUDE grootboekmapping-systeem
  // bewust ongemapt (dat systeem is niet het onderwerp van deze Delta Build); ze verschijnen daarom terecht in Balans'
  // eigen controleVereist, exact hetzelfde gedrag als het bestaande GL9999-geval in genereerBalansPeriode.test.ts.
  writeFileSync(
    grootboekmappingPad(root, ADMINISTRATIE_ID),
    JSON.stringify({ versie: "0.1", administratieId: ADMINISTRATIE_ID, regels: [{ grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" }] }),
    "utf-8",
  );

  rebuildCache({ root, administratieId: ADMINISTRATIE_ID, onVoortgang: () => {} });
  zaaiPnLMapping();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const CONTEXT_ALLE_MODULES = { boekjaar: 2026, boekperiodeTotEnMet: "06" };

describe("genereerSamengesteldRapport — selectie (criterium A)", () => {
  it("PNL geselecteerd: PNL wordt opgenomen; niet-geselecteerde HUURDERS/BALANS worden niet uitgevoerd en niet gerenderd", () => {
    const { rapport, html } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["pnl"] });

    const pnlSectie = rapport.secties.find((s) => s.id === "PNL")!;
    expect(pnlSectie.resultaat.status === "OPGENOMEN" || pnlSectie.resultaat.status === "ONVOLLEDIG").toBe(true);
    expect(rapport.secties.find((s) => s.id === "BALANS")!.resultaat).toEqual({ status: "NIET_GESELECTEERD" });
    expect(rapport.secties.find((s) => s.id === "HUURDERS")!.resultaat).toEqual({ status: "NIET_GESELECTEERD" });
    expect(html).not.toContain("Fruitcake BV"); // bewijst dat Huurdersoverzicht niet is uitgevoerd/gerenderd
  });

  it("uitsluitend HUURDERS geselecteerd draait GEEN P&L/Balans-berekening (geen boekjaar/periode nodig, andere modules blijven NIET_GESELECTEERD)", () => {
    const { rapport, html } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { modules: ["huurders"] });

    expect(rapport.secties.find((s) => s.id === "HUURDERS")!.resultaat.status).not.toBe("NIET_GESELECTEERD");
    expect(rapport.secties.find((s) => s.id === "PNL")!.resultaat).toEqual({ status: "NIET_GESELECTEERD" });
    expect(rapport.secties.find((s) => s.id === "BALANS")!.resultaat).toEqual({ status: "NIET_GESELECTEERD" });
    expect(html).toContain("Fruitcake BV");
  });
});

describe("genereerSamengesteldRapport — meerdere modules (criterium B)", () => {
  it("PNL+BALANS+HUURDERS: precies drie inhoudelijke secties, deterministische volgorde, geen dubbele uitvoering bij een dubbele module-id", () => {
    const { rapport, html } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["pnl", "pnl", "balans", "huurders"] });

    expect(rapport.secties).toHaveLength(3); // register heeft precies 3 ids in V1
    expect(rapport.secties.every((s) => s.resultaat.status !== "NIET_GESELECTEERD")).toBe(true);
    expect(rapport.secties.map((s) => s.id)).toEqual(["PNL", "BALANS", "HUURDERS"]); // vaste registervolgorde, ongeacht opgaafvolgorde
    // "PNL,PNL" mag niet tot twee keer dezelfde inhoud leiden.
    expect((html.match(/Winst- en verliesrekening/g) ?? []).length).toBeLessThanOrEqual(2); // cover-titel + eventueel 1x sectiekop, nooit verdubbeld door de dubbele selectie
  });
});

describe("genereerSamengesteldRapport — outputidentiteit (criterium C)", () => {
  it("PNL-sectie bevat exact de reeds bronbewezen 070 H1-2026-EBITDA", () => {
    const { rapport } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["pnl"] });
    const pnl = rapport.secties.find((s) => s.id === "PNL")!.resultaat as { status: "OPGENOMEN" | "ONVOLLEDIG"; html: string };

    expect(pnl.html).toContain("311.179,66");
    expect(pnl.html).toContain("341.734,81");
    expect(pnl.html).toContain("30.555,15");
  });

  it("BALANS-sectie is byte-identiek aan rechtstreeks aangeroepen genereerBalansPeriode + renderBalansPeriodeBody voor dezelfde context", () => {
    const { rapport } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["balans"] });
    const balansSectie = rapport.secties.find((s) => s.id === "BALANS")!.resultaat as { status: "OPGENOMEN" | "ONVOLLEDIG"; html: string };

    const config = leesAdministratieConfig(root, ADMINISTRATIE_ID);
    const { resultaat } = genereerBalansPeriode(root, ADMINISTRATIE_ID, CONTEXT_ALLE_MODULES);
    // renderBalansPeriodeBody gebruikt gegenereerdOp niet (dat zit uitsluitend in de Html-cover) — de waarde hier is dus irrelevant voor de vergelijking.
    const verwachteHtml = renderBalansPeriodeBody({ administratieNaam: config.weergavenaam, bedrijfsnr: config.bedrijfsnr, boekjaar: 2026, boekperiodeTotEnMet: "06", gegenereerdOp: new Date(0), resultaat });

    expect(balansSectie.html).toBe(verwachteHtml);
    // GL1010 (beginbalans 1000, geen 2026-mutatie op die rekening) moet exact 1000 tonen.
    expect(balansSectie.html).toContain("1.000,00");
  });

  it("HUURDERS-sectie is byte-identiek aan rechtstreeks aangeroepen genereerHuurdersoverzicht + renderHuurdersoverzichtBody voor dezelfde context", () => {
    const { rapport } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { modules: ["huurders"], huurdersPeildatum: new Date("2026-08-01T00:00:00.000Z") });
    const huurdersSectie = rapport.secties.find((s) => s.id === "HUURDERS")!.resultaat as { status: "OPGENOMEN" | "ONVOLLEDIG"; html: string };

    const config = leesAdministratieConfig(root, ADMINISTRATIE_ID);
    const resultaat = genereerHuurdersoverzicht(root, ADMINISTRATIE_ID, new Date("2026-08-01T00:00:00.000Z"));
    const verwachteHtml = renderHuurdersoverzichtBody(config.weergavenaam, resultaat);

    expect(huurdersSectie.html).toBe(verwachteHtml);
    expect(huurdersSectie.html).toContain("Fruitcake BV");
  });
});

describe("genereerSamengesteldRapport — documentstructuur (criterium D)", () => {
  it("levert één HTML-document, geen dubbele cover/documentstructuur, ondanks drie secties", () => {
    const { html } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["pnl", "balans", "huurders"] });

    expect((html.match(/<html/g) ?? []).length).toBe(1);
    expect((html.match(/<\/html>/g) ?? []).length).toBe(1);
    expect((html.match(/class="cover"/g) ?? []).length).toBe(1);
    expect((html.match(/<!DOCTYPE html>/g) ?? []).length).toBe(1);
  });
});

describe("genereerSamengesteldRapport — status (criterium E)", () => {
  it("PNL zonder boekjaar/periode wordt ONBESCHIKBAAR; BALANS/HUURDERS blijven daardoor niet geblokkeerd", () => {
    const { rapport, html } = genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { boekperiodeTotEnMet: "06", modules: ["pnl", "huurders"] }); // bewust GEEN boekjaar

    const pnl = rapport.secties.find((s) => s.id === "PNL")!.resultaat;
    expect(pnl.status).toBe("ONBESCHIKBAAR");
    if (pnl.status === "ONBESCHIKBAAR") {
      expect(pnl.reden.length).toBeGreaterThan(0);
      // De ONBESCHIKBAAR-sectie zelf toont uitsluitend deze reden-tekst (geen €-bedrag, geen "€ 0,00").
      expect(html).toContain(`<span class="ernst-kritiek">Onbeschikbaar — ${pnl.reden}</span>`);
    }
    const huurders = rapport.secties.find((s) => s.id === "HUURDERS")!.resultaat;
    expect(huurders.status === "OPGENOMEN" || huurders.status === "ONVOLLEDIG").toBe(true);
    expect(html).toContain("Fruitcake BV"); // Huurdersoverzicht bleef gewoon werken ondanks PNL's onbeschikbaarheid
  });
});

describe("genereerSamengesteldRapport — CLI-validatie (criterium F)", () => {
  it("een onbekende module-id geeft een duidelijke fout", () => {
    expect(() => genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: ["pnl", "onzin"] })).toThrow(/Onbekende module-id/);
  });

  it("geen enkele module opgeven geeft een duidelijke fout", () => {
    expect(() => genereerSamengesteldRapport(root, ADMINISTRATIE_ID, { ...CONTEXT_ALLE_MODULES, modules: [] })).toThrow(/Minimaal één module/);
  });
});
