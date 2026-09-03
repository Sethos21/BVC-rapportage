import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerOpenstaandePosten } from "./genereerOpenstaandePosten.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;
const ADMIN = "070_rooisezoom";
const OUDERDOMSANALYSE_METADATA = { boekjaar: 2026, boekperiode: "09", peildatum: new Date(Date.UTC(2026, 8, 30)) };

/**
 * Echte 070_Rooise_Zoom-cijfers (2026-08-31, packages/reporting/README.md):
 * de 10 daadwerkelijk openstaande vorderingen_met_afboekingen-regels +
 * alle 14 saldo_huurders-regels — bewezen 14/14 exact MATCH, totaal
 * € 65.811,57, inclusief de iTapToo-contractsplitsing (044/049) en de
 * creditpost (huurder 00000033, -€146,90).
 */
const OPEN_POSTEN_070: Record<string, unknown>[] = [
  { Bedrijfsnr: "070", Contractnr: "0000000028", Vordering_Volgnr: "00000093", Huurdernr: "00000021", Complexnummer: "002", Unitnummer: "0001", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000108", Vordering_Totaalbedrag: 5940.98, Bedrag_afgeboekt: 0, Vordering_openstaand: 5940.98, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000029", Vordering_Volgnr: "00000092", Huurdernr: "00000022", Complexnummer: "002", Unitnummer: "0002", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000109", Vordering_Totaalbedrag: 2388.39, Bedrag_afgeboekt: 0, Vordering_openstaand: 2388.39, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000031", Vordering_Volgnr: "00000095", Huurdernr: "00000024", Complexnummer: "003", Unitnummer: "0001", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000110", Vordering_Totaalbedrag: 4814.17, Bedrag_afgeboekt: 0, Vordering_openstaand: 4814.17, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000043", Vordering_Volgnr: "00000063", Huurdernr: "00000028", Complexnummer: "001", Unitnummer: null, Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000106", Vordering_Totaalbedrag: 15384.74, Bedrag_afgeboekt: 0, Vordering_openstaand: 15384.74, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000044", Vordering_Volgnr: "00000061", Huurdernr: "00000030", Complexnummer: "003", Unitnummer: "0003", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000112", Vordering_Totaalbedrag: 3544.33, Bedrag_afgeboekt: 0, Vordering_openstaand: 3544.33, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000049", Vordering_Volgnr: "00000030", Huurdernr: "00000030", Complexnummer: "003", Unitnummer: "0004", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000113", Vordering_Totaalbedrag: 1409.38, Bedrag_afgeboekt: 0, Vordering_openstaand: 1409.38, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000045", Vordering_Volgnr: "00000057", Huurdernr: "00000031", Complexnummer: "004", Unitnummer: "0001", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000114", Vordering_Totaalbedrag: 13970.47, Bedrag_afgeboekt: 0, Vordering_openstaand: 13970.47, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000046", Vordering_Volgnr: "00000058", Huurdernr: "00000032", Complexnummer: "004", Unitnummer: "0002", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000115", Vordering_Totaalbedrag: 14174.36, Bedrag_afgeboekt: 0, Vordering_openstaand: 14174.36, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000051", Vordering_Volgnr: "00000022", Huurdernr: "00000034", Complexnummer: "003", Unitnummer: "0002", Datum_Vordering: "01-09-2026", Omschrijving_Vordering: "Periode september 2026", Factuurnummer: "2670000111", Vordering_Totaalbedrag: 4331.65, Bedrag_afgeboekt: 0, Vordering_openstaand: 4331.65, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
  { Bedrijfsnr: "070", Contractnr: "0000000048", Vordering_Volgnr: "00000023", Huurdernr: "00000033", Complexnummer: "001", Unitnummer: "0002", Datum_Vordering: "15-04-2026", Omschrijving_Vordering: "Service-afrekening 0004", Factuurnummer: "2670000047", Vordering_Totaalbedrag: -146.9, Bedrag_afgeboekt: 0, Vordering_openstaand: -146.9, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null },
];

// Eén al-afgeboekte post erbij, bewijst dat openstaand=0 niet als "openstaande post" meetelt.
const AFGEBOEKTE_POST_070: Record<string, unknown> = {
  Bedrijfsnr: "070", Contractnr: "0000000028", Vordering_Volgnr: "00000092", Huurdernr: "00000021", Complexnummer: "002", Unitnummer: "0001",
  Datum_Vordering: "01-08-2026", Omschrijving_Vordering: "Periode augustus 2026", Factuurnummer: "2670000090",
  Vordering_Totaalbedrag: 5940.98, Bedrag_afgeboekt: 5940.98, Vordering_openstaand: 0, Vordering_afgehandeld_periode: "08", Vordering_afgehandeld_jaar: "2026",
};

const SALDO_HUURDERS_070: Record<string, unknown>[] = [
  { Bedrijfsnr: "070", Huurdernr: "00000021", Naam_1: "Fruitcake BV", Achterstand: 5940.98, Achterstand_tm_30_dagen: 5940.98, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 5940.98 },
  { Bedrijfsnr: "070", Huurdernr: "00000022", Naam_1: "JOB Personeelsmakelaar BV", Achterstand: 2388.39, Achterstand_tm_30_dagen: 2388.39, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 2388.39 },
  { Bedrijfsnr: "070", Huurdernr: "00000023", Naam_1: "Vicoma Zuid BV", Achterstand: 0, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 0 },
  { Bedrijfsnr: "070", Huurdernr: "00000024", Naam_1: "Meierij Accountancy & Advies B.V.", Achterstand: 4814.17, Achterstand_tm_30_dagen: 4814.17, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 4814.17 },
  { Bedrijfsnr: "070", Huurdernr: "00000025", Naam_1: "Xxllnc Belastingen BV", Achterstand: 0, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 0 },
  { Bedrijfsnr: "070", Huurdernr: "00000026", Naam_1: "Gebr. van Houtum", Achterstand: 0, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 0 },
  { Bedrijfsnr: "070", Huurdernr: "00000027", Naam_1: "IT2 Informatie en Technology BV", Achterstand: 0, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 0 },
  { Bedrijfsnr: "070", Huurdernr: "00000028", Naam_1: "Destiny B.V.", Achterstand: 15384.74, Achterstand_tm_30_dagen: 15384.74, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 15384.74 },
  { Bedrijfsnr: "070", Huurdernr: "00000029", Naam_1: "Accountants Office B.V.", Achterstand: 0, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 0 },
  { Bedrijfsnr: "070", Huurdernr: "00000030", Naam_1: "iTapToo Drinks B.V.", Achterstand: 4953.71, Achterstand_tm_30_dagen: 4953.71, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 4953.71 },
  { Bedrijfsnr: "070", Huurdernr: "00000031", Naam_1: "Basic Fit Nederland B.V.", Achterstand: 13970.47, Achterstand_tm_30_dagen: 13970.47, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 13970.47 },
  { Bedrijfsnr: "070", Huurdernr: "00000032", Naam_1: "Kinderopvang 't Kroontje Veghel", Achterstand: 14174.36, Achterstand_tm_30_dagen: 14174.36, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 14174.36 },
  { Bedrijfsnr: "070", Huurdernr: "00000033", Naam_1: "Bright Accountants en Adviseurs B.V.", Achterstand: -146.9, Achterstand_tm_30_dagen: 0, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: -146.9, Vooruitbetaling: 0, Saldo: -146.9 },
  { Bedrijfsnr: "070", Huurdernr: "00000034", Naam_1: "TEUN Marketing", Achterstand: 4331.65, Achterstand_tm_30_dagen: 4331.65, Achterstand_tm_60_dagen: 0, Achterstand_tm_90_dagen: 0, Achterstand_90plus_dagen: 0, Vooruitbetaling: 0, Saldo: 4331.65 },
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-openstaande-posten-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMIN), { recursive: true });
  schrijfAdministratieConfig(root, ADMIN, nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "vorderingen_met_afboekingen.xlsx"), [...OPEN_POSTEN_070, AFGEBOEKTE_POST_070]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "saldo_huurders.xlsx"), SALDO_HUURDERS_070);

  rebuildCache({ root, administratieId: ADMIN, onVoortgang: () => {}, ouderdomsanalyseMetadata: OUDERDOMSANALYSE_METADATA });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerOpenstaandePosten — 070_Rooise_Zoom regressie (volledige xlsx->cache->worker-pijplijn)", () => {
  it("reconcilieert exact: detail-openstaand € 65.811,57 = saldo_huurders € 65.811,57, 14/14 huurders MATCH (debiteurenbeheer=true)", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });

    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    expect(resultaat.totaalOpenstaandDetail.toString()).toBe("65811.57");
    expect(resultaat.totaalSaldoHuurders.toString()).toBe("65811.57");
    expect(resultaat.huurders).toHaveLength(14);
    expect(resultaat.controleVereist).toHaveLength(0); // geen enkel verschil -> geen WAARSCHUWING.

    for (const h of resultaat.huurders) {
      expect(h.verschilMetSaldo?.toString(), h.huurdernummer).toBe("0");
    }
  });

  it("de al-afgeboekte post (openstaand=0) telt niet mee in de openstaande-postenlijst", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    const huurder21 = resultaat.huurders.find((h) => h.huurdernummer === "00000021")!;
    expect(huurder21.openstaandePosten).toHaveLength(1); // alleen de september-post, niet de al-afgeboekte augustus-post.
    expect(huurder21.openstaandePosten[0]?.vorderingVolgnummer).toBe("00000093");
  });

  it("iTapToo (huurdernr 00000030): contract 044 = € 3.544,33, contract 049 = € 1.409,38, totaal € 4.953,71 — exact aansluitend op saldo_huurders", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    const iTapToo = resultaat.huurders.find((h) => h.huurdernummer === "00000030")!;

    expect(iTapToo.openstaandePosten).toHaveLength(2);
    const c044 = iTapToo.openstaandePosten.find((p) => p.contractnummer === "0000000044")!;
    const c049 = iTapToo.openstaandePosten.find((p) => p.contractnummer === "0000000049")!;
    expect(c044.openstaand.toString()).toBe("3544.33");
    expect(c049.openstaand.toString()).toBe("1409.38");
    expect(iTapToo.detailtotaal.toString()).toBe("4953.71");
    expect(iTapToo.saldoHuurders?.toString()).toBe("4953.71");
    expect(iTapToo.verschilMetSaldo?.toString()).toBe("0");
  });

  it("contract 0000000043 (Destiny) heeft geen unitnummer — blijft null, geen crash, geen verzonnen waarde", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    const destiny = resultaat.huurders.find((h) => h.huurdernummer === "00000028")!;
    expect(destiny.openstaandePosten[0]?.unitnummer).toBeNull();
    expect(destiny.detailtotaal.toString()).toBe("15384.74");
  });

  it("de negatieve openstaande post (huurder 00000033, credit) blijft exact negatief — nooit Math.abs()", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    const huurder33 = resultaat.huurders.find((h) => h.huurdernummer === "00000033")!;
    expect(huurder33.detailtotaal.toString()).toBe("-146.9");
    expect(huurder33.saldoHuurders?.toString()).toBe("-146.9");
    expect(huurder33.buckets?.negentigPlus.toString()).toBe("-146.9");
  });

  it("debiteurenbeheer=true (070 bevestigd): reconciliatieverschillen leveren WAARSCHUWING op", () => {
    // Simuleer een niet-sluitende situatie door één post net te wijzigen (test-only manipulatie via afzonderlijke cache-run).
    schrijfXlsxFixture(join(bronGedeeldDir(root), "vorderingen_met_afboekingen.xlsx"), [
      { ...OPEN_POSTEN_070[0], Vordering_openstaand: 999, Vordering_Totaalbedrag: 999 },
      ...OPEN_POSTEN_070.slice(1),
      AFGEBOEKTE_POST_070,
    ]);
    rebuildCache({ root, administratieId: ADMIN, onVoortgang: () => {}, ouderdomsanalyseMetadata: OUDERDOMSANALYSE_METADATA });
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });

    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.huurdernummer === "00000021")).toBe(true);
  });

  it("debiteurenbeheer=false: geen WAARSCHUWING, wel één structurele INFORMATIEF-melding over niet-bijgehouden bankaflettering", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: false } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" || c.ernst === "KRITIEK")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("niet door ons bijgehouden"))).toBe(true);
    // De cijfers blijven gewoon berekend, ondanks de false-status.
    expect(resultaat.totaalOpenstaandDetail.toString()).toBe("65811.57");
  });

  it('debiteurenbeheer ontbreekt in administratie.json (legacy-config): leest aan als "onbekend", NOOIT automatisch true', () => {
    // Schrijf een config-object zonder het debiteurenbeheer-veld, alsof het een oude administratie.json is.
    const legacyConfig = nieuweAdministratieConfig("070", "Rooise Zoom");
    delete (legacyConfig as { debiteurenbeheer?: unknown }).debiteurenbeheer;
    schrijfAdministratieConfig(root, ADMIN, legacyConfig);

    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    expect(resultaat.debiteurenbeheer).toBe("onbekend");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("nog niet geclassificeerd"))).toBe(true);
  });

  it("saldo_huurders-buckets komen ongewijzigd uit de cache (voorheen ouderdomsanalyse-tabel), niet zelfberekend", () => {
    schrijfAdministratieConfig(root, ADMIN, { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    const resultaat = genereerOpenstaandePosten(root, ADMIN);
    const huurder21 = resultaat.huurders.find((h) => h.huurdernummer === "00000021")!;
    expect(huurder21.buckets).toEqual({
      tm30: expect.objectContaining({}),
      tm60: expect.objectContaining({}),
      tm90: expect.objectContaining({}),
      negentigPlus: expect.objectContaining({}),
      vooruitbetaling: expect.objectContaining({}),
    });
    expect(huurder21.buckets?.tm30.toString()).toBe("5940.98");
  });
});
