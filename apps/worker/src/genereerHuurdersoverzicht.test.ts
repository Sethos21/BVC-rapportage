import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerHuurdersoverzicht } from "./genereerHuurdersoverzicht.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

/**
 * Volledige, echte 070_Rooise_Zoom-dataset (12 contracten) uit de door de
 * gebruiker gedraaide `contract-huurder-diagnose` (2026-08-27) — zelfde
 * bron als de regressietest in packages/reporting/src/huurdersoverzicht.test.ts,
 * hier via de volledige xlsx->cache->worker-pijplijn (incl. de nieuwe
 * contracten-kolommen) om te bewijzen dat de kolomtoevoegingen correct
 * rondgaan door rebuildCache/de cache.
 */
interface Echt070Contract {
  contract: string;
  complex: string;
  unit: string | null;
  huurdernr: string;
  huurderNaam: string;
  ingang: string;
  expiratie: string;
  opzeg: string;
  waarborg: string;
  objectomschrijving: string;
  verhogingDatum: string;
  verhogingJaar: string;
  verhogingPeriode: string;
  verhogingPct: string;
  verhogingMethode: string;
  indextabel: string | null;
  bruto: string;
  m2: string;
  svc: string;
  korting?: string;
  /** Laatste bekende contract_verhogingen-regel (jaar/periode/oud/nieuw VS_01), Status="Verwerkt"/Toekomstige_verhoging="Nee" — ontbreekt voor 0000000052 (geen historie, bewezen 070-geval). */
  verhoging?: { jaar: string; periode: string; oud: string; nieuw: string };
}

const ECHTE_070_CONTRACTEN: Echt070Contract[] = [
  { contract: "0000000028", complex: "002", unit: "0001", huurdernr: "00000021", huurderNaam: "Fruitcake BV", ingang: "01-01-2020", expiratie: "31-12-2029", opzeg: "31-12-2028", waarborg: "0", objectomschrijving: "Villa II", verhogingDatum: "01-07-2027", verhogingJaar: "2027", verhogingPeriode: "07", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "37318.8", m2: "320", svc: "21600", verhoging: { jaar: "2026", periode: "07", oud: "3028.6", nieuw: "3109.9" } },
  { contract: "0000000029", complex: "002", unit: "0002", huurdernr: "00000022", huurderNaam: "JOB Personeelsmakelaar BV", ingang: "01-06-2016", expiratie: "31-05-2031", opzeg: "31-05-2030", waarborg: "0", objectomschrijving: "Villa II", verhogingDatum: "01-05-2027", verhogingJaar: "2027", verhogingPeriode: "05", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "14686.56", m2: "139", svc: "9000", verhoging: { jaar: "2026", periode: "07", oud: "1191.88", nieuw: "1223.88" } },
  { contract: "0000000031", complex: "003", unit: "0001", huurdernr: "00000024", huurderNaam: "Meierij Accountancy & Advies B.V.", ingang: "01-01-2016", expiratie: "31-12-2030", opzeg: "31-12-2029", waarborg: "0", objectomschrijving: "Villa III", verhogingDatum: "01-01-2027", verhogingJaar: "2027", verhogingPeriode: "01", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "29383.8", m2: "255", svc: "18360", verhoging: { jaar: "2026", periode: "01", oud: "2371", nieuw: "2448.65" } },
  { contract: "0000000038", complex: "001", unit: "0003", huurdernr: "00000027", huurderNaam: "IT2 Informatie en Technology BV", ingang: "01-05-2015", expiratie: "30-04-2028", opzeg: "30-04-2027", waarborg: "0", objectomschrijving: "Villa I", verhogingDatum: "01-05-2027", verhogingJaar: "2027", verhogingPeriode: "05", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "37617.12", m2: "320", svc: "18000", verhoging: { jaar: "2026", periode: "05", oud: "3059.83", nieuw: "3134.76" } },
  { contract: "0000000043", complex: "001", unit: null, huurdernr: "00000028", huurderNaam: "Destiny B.V.", ingang: "28-08-2021", expiratie: "31-05-2030", opzeg: "31-05-2029", waarborg: "0", objectomschrijving: "Villa I", verhogingDatum: "01-06-2027", verhogingJaar: "2027", verhogingPeriode: "06", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "92875.92", m2: "750", svc: "59700", verhoging: { jaar: "2026", periode: "06", oud: "7559.61", nieuw: "7739.66" } },
  { contract: "0000000044", complex: "003", unit: "0003", huurdernr: "00000030", huurderNaam: "iTapToo Drinks B.V.", ingang: "01-07-2022", expiratie: "30-06-2028", opzeg: "30-06-2027", waarborg: "8860.23", objectomschrijving: "Villa III", verhogingDatum: "01-07-2027", verhogingJaar: "2027", verhogingPeriode: "07", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "23150.4", m2: "202", svc: "12000", verhoging: { jaar: "2026", periode: "07", oud: "1878.77", nieuw: "1929.2" } },
  { contract: "0000000045", complex: "004", unit: "0001", huurdernr: "00000031", huurderNaam: "Basic Fit Nederland B.V.", ingang: "01-01-2011", expiratie: "31-12-2031", opzeg: "31-12-2030", waarborg: "0", objectomschrijving: "Prins Willem Alexander Sportpark", verhogingDatum: "01-01-2027", verhogingJaar: "2027", verhogingPeriode: "01", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "136150.08", m2: "1633.5", svc: "2400", verhoging: { jaar: "2026", periode: "01", oud: "10986.07", nieuw: "11345.84" } },
  { contract: "0000000046", complex: "004", unit: "0002", huurdernr: "00000032", huurderNaam: "Kinderopvang 't Kroontje Veghel", ingang: "01-01-2011", expiratie: "31-12-2030", opzeg: "31-12-2029", waarborg: "0", objectomschrijving: "Prins Willem Alexander Sportpark", verhogingDatum: "01-01-2027", verhogingJaar: "2027", verhogingPeriode: "01", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "170092.32", m2: "1700", svc: "0", verhoging: { jaar: "2026", periode: "01", oud: "13724.89", nieuw: "14174.36" } },
  { contract: "0000000048", complex: "001", unit: "0002", huurdernr: "00000033", huurderNaam: "R. Duckers", ingang: "01-04-2023", expiratie: "30-04-2028", opzeg: "30-04-2027", waarborg: "0", objectomschrijving: "Roermond, Hoekstraat", verhogingDatum: "01-07-2027", verhogingJaar: "2027", verhogingPeriode: "07", verhogingPct: "4.1", verhogingMethode: "Percentage", indextabel: null, bruto: "38137.44", m2: "320", svc: "16000", verhoging: { jaar: "2026", periode: "01", oud: "9232.03", nieuw: "9534.36" } },
  { contract: "0000000049", complex: "003", unit: "0004", huurdernr: "00000030", huurderNaam: "Tausch Production BV", ingang: "15-09-2024", expiratie: "30-06-2028", opzeg: "30-06-2027", waarborg: "0", objectomschrijving: "Nobelweg 1 Schijndel", verhogingDatum: "01-07-2027", verhogingJaar: "2027", verhogingPeriode: "07", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "12777.36", m2: "120", svc: "7200", korting: "-6000", verhoging: { jaar: "2026", periode: "07", oud: "1036.94", nieuw: "1064.78" } },
  { contract: "0000000051", complex: "003", unit: "0002", huurdernr: "00000034", huurderNaam: "Diëtistenpraktijk Mariël Kranenbroek", ingang: "01-05-2025", expiratie: "30-04-2030", opzeg: "30-04-2029", waarborg: "650", objectomschrijving: "Cuijk 33A", verhogingDatum: "01-09-2027", verhogingJaar: "2027", verhogingPeriode: "09", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "34078.56", m2: "335", svc: "16800", korting: "-7920", verhoging: { jaar: "2026", periode: "05", oud: "2772", nieuw: "2839.88" } },
  { contract: "0000000052", complex: "002", unit: "0003", huurdernr: "00000023", huurderNaam: "Praktijk voor Seksuologische Therapie", ingang: "01-04-2026", expiratie: "31-03-2031", opzeg: "01-04-2029", waarborg: "440", objectomschrijving: "Cuijk 33A", verhogingDatum: "01-04-2027", verhogingJaar: "2027", verhogingPeriode: "04", verhogingPct: "0", verhogingMethode: "Prijsindex", indextabel: "CPI 2025 = 100", bruto: "61632.52", m2: "495", svc: "48000" }, // bewezen: GEEN eigen verhogingshistorie (contract 0000000037's historie mag niet worden overgenomen).
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-huurdersoverzicht-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  schrijfXlsxFixture(
    join(bronGedeeldDir(root), "contracten_huidig.xlsx"),
    ECHTE_070_CONTRACTEN.map((c) => ({
      Bedrijfsnr: "070", Contract: c.contract, Complexnummer: c.complex, Unitnummer: c.unit, Huurdernummer: c.huurdernr,
      Ingangsdatum: c.ingang, Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: c.expiratie, Expiratie_Opzegdatum: c.opzeg, Expiratie_Aantal_per_optie: 12, Expiratie_huidige: "Ja",
      Huurder_Naam_1: c.huurderNaam, Waarborgsom: c.waarborg, Complexomschrijving: c.objectomschrijving,
      Verhoging_datum: c.verhogingDatum, Verhoging_Jaar_vlgd: c.verhogingJaar, Verhoging_Periode_vlgd: c.verhogingPeriode,
      Verhoging_percentage: c.verhogingPct, Verhoging_methode: c.verhogingMethode, Omschrijving_indextabel: c.indextabel,
    })),
  );

  schrijfXlsxFixture(
    join(bronGedeeldDir(root), "rentroll.xlsx"),
    ECHTE_070_CONTRACTEN.flatMap((c) => {
      const regels: Record<string, unknown>[] = [
        {
          Bedrijfsnummer: "070", Contractnummer: c.contract, Vorderingsoort: "01", Unitnummer: c.unit, Complexnummer: c.complex,
          Rapportage_datum: "31-07-2026", Prolongatie_bedrag_jaar: c.bruto, Korting_bedrag_jaar: "0",
          Service_voorschot_jaar: c.svc, Gehuurd_oppervlak: c.m2,
          Contract_expiratiedatum: c.expiratie, Contract_opzegdatum: c.opzeg,
        },
      ];
      if (c.korting) {
        regels.push({
          Bedrijfsnummer: "070", Contractnummer: c.contract, Vorderingsoort: "13", Unitnummer: c.unit, Complexnummer: c.complex,
          Rapportage_datum: "31-07-2026", Prolongatie_bedrag_jaar: c.korting, Korting_bedrag_jaar: "0",
          Service_voorschot_jaar: null, Gehuurd_oppervlak: "0",
          Contract_expiratiedatum: c.expiratie, Contract_opzegdatum: c.opzeg,
        });
      }
      return regels;
    }),
  );

  schrijfXlsxFixture(
    join(bronGedeeldDir(root), "contract_verhogingen.xlsx"),
    [
      ...ECHTE_070_CONTRACTEN.filter((c) => c.verhoging).map((c) => ({
        Bedrijfsnr: "070", Contract: c.contract, Jaar: c.verhoging!.jaar, Periode: c.verhoging!.periode,
        Status: "Verwerkt", Toekomstige_verhoging: "Nee", Bedrag_oud_VS_01: c.verhoging!.oud, Bedrag_Nieuw_VS_01: c.verhoging!.nieuw,
      })),
      // Bewezen 070-geval: contract 0000000037 heeft dezelfde huurdernummer/complex/unit als 0000000052,
      // maar is een ANDER contractnummer — mag nooit als 052's historie gebruikt worden.
      { Bedrijfsnr: "070", Contract: "0000000037", Jaar: "2025", Periode: "04", Status: "Verwerkt", Toekomstige_verhoging: "Nee", Bedrag_oud_VS_01: "26496.01", Bedrag_Nieuw_VS_01: "27581.41" },
    ],
  );

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerHuurdersoverzicht — 070_Rooise_Zoom regressie (volledige xlsx->cache->worker-pijplijn)", () => {
  it("reconcilieert exact naar het bevestigde huur-kerncijfers-regressiepunt en geeft één regel per contract", () => {
    const resultaat = genereerHuurdersoverzicht(root, "070_rooisezoom");

    expect(resultaat.contracten).toHaveLength(12);
    expect(resultaat.momentopname).toBe(true);
    expect(resultaat.bronPeildatum).toEqual(new Date("2026-07-31T00:00:00.000Z"));

    expect((resultaat.portefeuilleTotalen.brutoJaarhuur as { waarde: { toString(): string } }).waarde.toString()).toBe("687900.88");
    expect((resultaat.portefeuilleTotalen.huurkorting as { waarde: { toString(): string } }).waarde.toString()).toBe("13920");
    expect((resultaat.portefeuilleTotalen.nettoJaarhuur as { waarde: { toString(): string } }).waarde.toString()).toBe("673980.88");
    expect((resultaat.portefeuilleTotalen.gehuurdOppervlak as { waarde: { toString(): string } }).waarde.toString()).toBe("6589.5");

    const c28 = resultaat.contracten.find((c) => c.contractnummer === "0000000028")!;
    expect(c28.huurderNaam).toBe("Fruitcake BV");
    expect(c28.objectomschrijving).toBe("Villa II");
    expect(c28.complexnummer).toBe("002");
    expect(c28.servicekostenvoorschotJaar?.toString()).toBe("21600");
    expect(c28.waarborgsom?.toString()).toBe("0");
    expect(c28.indexering.methode).toBe("Prijsindex");
    expect(c28.indexering.volgendeIndexeringsdatum).toEqual(new Date("2027-07-01T00:00:00.000Z"));

    const c43 = resultaat.contracten.find((c) => c.contractnummer === "0000000043")!;
    expect(c43.unitnummer).toBeNull(); // nooit afgeleid, bekend 070-geval.
    expect(c43.huur.gehuurdOppervlak).toEqual({ type: "bekend", waarde: expect.objectContaining({}) });
    expect((c43.huur.gehuurdOppervlak as { waarde: { toString(): string } }).waarde.toString()).toBe("750");

    const c48 = resultaat.contracten.find((c) => c.contractnummer === "0000000048")!;
    expect(c48.indexering.methode).toBe("Percentage");
    expect(c48.indexering.vastPercentage?.toString()).toBe("4.1");
    expect(c48.indexering.omschrijvingIndextabel).toBeNull();

    const c44 = resultaat.contracten.find((c) => c.contractnummer === "0000000044")!;
    expect(c44.waarborgsom?.toString()).toBe("8860.23");

    // Twee contracten (002/003) delen "Cuijk 33A" als objectomschrijving — bewust geen groeperingseffect: complexnummer blijft leidend.
    const c51 = resultaat.contracten.find((c) => c.contractnummer === "0000000051")!;
    const c52 = resultaat.contracten.find((c) => c.contractnummer === "0000000052")!;
    expect(c51.objectomschrijving).toBe("Cuijk 33A");
    expect(c52.objectomschrijving).toBe("Cuijk 33A");
    expect(c51.complexnummer).toBe("003");
    expect(c52.complexnummer).toBe("002");

    expect(resultaat.controleVereist.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
  });

  it("vult laatsteIndexatie voor de 11 contracten met historie, en houdt contract 0000000052 op null (geen eigen historie, 037 nooit gekoppeld)", () => {
    const resultaat = genereerHuurdersoverzicht(root, "070_rooisezoom");

    const metHistorie = ECHTE_070_CONTRACTEN.filter((c) => c.verhoging);
    expect(metHistorie).toHaveLength(11);
    for (const c of metHistorie) {
      const regel = resultaat.contracten.find((r) => r.contractnummer === c.contract)!;
      expect(regel.laatsteIndexatie?.jaar).toBe(c.verhoging!.jaar);
      expect(regel.laatsteIndexatie?.periode).toBe(c.verhoging!.periode);
      expect(regel.laatsteIndexatie?.oudMaandhuurbedrag.toString()).toBe(c.verhoging!.oud);
      expect(regel.laatsteIndexatie?.nieuwMaandhuurbedrag.toString()).toBe(c.verhoging!.nieuw);
    }

    const c28 = resultaat.contracten.find((c) => c.contractnummer === "0000000028")!;
    expect(c28.laatsteIndexatie?.effectiefPercentage.toFixed(2)).toBe("2.68");

    const c52 = resultaat.contracten.find((c) => c.contractnummer === "0000000052")!;
    expect(c52.laatsteIndexatie).toBeNull(); // contract 0000000037's historie (zelfde huurder/complex/unit) wordt NOOIT overgenomen.

    // Contract 048: historische indexatie blijft geldig (×3 t.o.v. actuele rentroll), puur een WAARSCHUWING.
    const c48 = resultaat.contracten.find((c) => c.contractnummer === "0000000048")!;
    expect(c48.laatsteIndexatie).not.toBeNull();
    expect(resultaat.controleVereist.some((i) => i.contractnummer === "0000000048" && i.ernst === "WAARSCHUWING" && i.bericht.includes("wijkt af van de actuele bruto jaarhuur"))).toBe(true);
  });
});

/**
 * Echte 070-openstaand-posten (2026-08-31, packages/reporting/README.md):
 * 10 daadwerkelijk openstaande vorderingen_met_afboekingen-regels + alle 14
 * saldo_huurders-regels — bewezen 14/14 exact MATCH, totaal € 65.811,57,
 * inclusief de iTapToo-contractsplitsing (044/049) en de creditpost
 * (huurder 00000033, -€146,90). Zelfde brondata als
 * apps/worker/src/genereerOpenstaandePosten.test.ts, hier via
 * genereerHuurdersoverzicht om de contract-niveau-koppeling te bewijzen.
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

describe("genereerHuurdersoverzicht — openstaandSaldo per contract (echte 070-openstaand-posten, 2026-09-01)", () => {
  beforeEach(() => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "vorderingen_met_afboekingen.xlsx"), OPEN_POSTEN_070);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "saldo_huurders.xlsx"), SALDO_HUURDERS_070);
    schrijfAdministratieConfig(root, "070_rooisezoom", { ...nieuweAdministratieConfig("070", "Rooise Zoom"), debiteurenbeheer: { bankAfletteringDoorOns: true } });
    rebuildCache({
      root,
      administratieId: "070_rooisezoom",
      onVoortgang: () => {},
      ouderdomsanalyseMetadata: { boekjaar: 2026, boekperiode: "09", peildatum: new Date(Date.UTC(2026, 8, 30)) },
    });
  });

  it("elk contract krijgt uitsluitend zijn EIGEN detailsom als openstaandSaldo, nooit het huurderniveau-saldo", () => {
    const resultaat = genereerHuurdersoverzicht(root, "070_rooisezoom");

    const c044 = resultaat.contracten.find((c) => c.contractnummer === "0000000044")!;
    const c049 = resultaat.contracten.find((c) => c.contractnummer === "0000000049")!;
    expect(c044.openstaandSaldo.toString()).toBe("3544.33");
    expect(c049.openstaandSaldo.toString()).toBe("1409.38");
    expect(c044.aantalOpenstaandePosten).toBe(1);
    expect(c049.aantalOpenstaandePosten).toBe(1);
    // Cruciale regel: NOOIT het huurdertotaal (4953.71) op één van beide contractregels.
    expect(c044.openstaandSaldo.toString()).not.toBe("4953.71");
    expect(c049.openstaandSaldo.toString()).not.toBe("4953.71");
    // Geen dubbeltelling: som van beide contractregels = het bewezen huurdertotaal.
    expect(c044.openstaandSaldo.plus(c049.openstaandSaldo).toString()).toBe("4953.71");

    const c028 = resultaat.contracten.find((c) => c.contractnummer === "0000000028")!;
    expect(c028.openstaandSaldo.toString()).toBe("5940.98");

    // Destiny (0000000043, geen unitnummer) blijft correct.
    const c043 = resultaat.contracten.find((c) => c.contractnummer === "0000000043")!;
    expect(c043.unitnummer).toBeNull();
    expect(c043.openstaandSaldo.toString()).toBe("15384.74");

    // Contract 0000000052: huurder zonder openstaande posten (Vicoma Zuid BV, saldo_huurders = 0).
    const c052 = resultaat.contracten.find((c) => c.contractnummer === "0000000052")!;
    expect(c052.openstaandSaldo.toString()).toBe("0");
    expect(c052.aantalOpenstaandePosten).toBe(0);

    // Credit (contract 0000000048) blijft exact negatief.
    const c048 = resultaat.contracten.find((c) => c.contractnummer === "0000000048")!;
    expect(c048.openstaandSaldo.toString()).toBe("-146.9");

    // Totale detailpositie 070 blijft € 65.811,57, en de huurderniveau-reconciliatie sluit exact
    // (geen WAARSCHUWING over een detail/saldo_huurders-verschil — de bekende contract-048-
    // indexatiewaarschuwing hieronder is een ANDER, al-bestaand signaal, niet gerelateerd aan openstaand).
    const totaalOpenstaand = resultaat.contracten.reduce((som, c) => som.plus(c.openstaandSaldo), new Decimal(0));
    expect(totaalOpenstaand.toString()).toBe("65811.57");
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("saldo_huurders"))).toBe(false);
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("wijkt af van de actuele bruto jaarhuur"))).toBe(true); // bekend, al-bewezen contract-048-signaal.
  });

  it("laat de bestaande huur-/indexatie-/servicekostenfunctionaliteit onaangetast door de openstaandSaldo-integratie", () => {
    const resultaat = genereerHuurdersoverzicht(root, "070_rooisezoom");
    expect((resultaat.portefeuilleTotalen.brutoJaarhuur as { waarde: { toString(): string } }).waarde.toString()).toBe("687900.88");
    const c28 = resultaat.contracten.find((c) => c.contractnummer === "0000000028")!;
    expect(c28.laatsteIndexatie?.effectiefPercentage.toFixed(2)).toBe("2.68");
    expect(c28.servicekostenvoorschotJaar?.toString()).toBe("21600");
  });
});
