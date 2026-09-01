import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
