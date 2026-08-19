import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GrootboekMappingConfig } from "@bvc/config";

/** Schrijft rijen als een echte .xlsx (geen gefabriceerde bestandsstructuur — een echt SheetJS-workbook). */
export function schrijfXlsxFixture(pad: string, rijen: Record<string, unknown>[], sheetNaam = "Blad1"): void {
  mkdirSync(dirname(pad), { recursive: true });
  const sheet = XLSX.utils.json_to_sheet(rijen);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetNaam);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(pad, buffer);
}

/** Bouwt een geldig .xlsx-bestand en knipt het daarna af — simuleert een écht corrupt/afgebroken bestand (bv. een mislukte netwerkkopie), i.t.t. willekeurige tekst die SheetJS soms stilzwijgend als lege sheet interpreteert. */
export function schrijfAfgebrokenXlsxFixture(pad: string): void {
  mkdirSync(dirname(pad), { recursive: true });
  const sheet = XLSX.utils.json_to_sheet([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Blad1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(pad, buffer.subarray(0, Math.floor(buffer.length * 0.6)));
}

/**
 * Twee administraties (070 "Rooise Zoom" en 074 "Fergagne") door elkaar in
 * dezelfde gedeelde bron — kolomkoppen exact zoals geverifieerd tegen de
 * echte IDBC-bronbestanden (zie packages/data-contracts/src/sources/*.ts
 * en de Drive-broninventarisatie). Uitsluitend synthetische testwaarden.
 */
export function boekingenRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Boekstuk_Sleutel: "070420024001", Boeking_Dagboeknr: "20",
      Boeking_Boekjaar: 2024, Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001",
      Boeking_Boekdatum: "01-01-2024", Boeking_Grootboeknr: "1010", Boeking_Kostenplaatsnr: null,
      Boeking_Complexnr: "01", Boeking_Unitnr: "001", Boeking_Contractnr: "C1", Boeking_Huurdernr: "H1",
      Boeking_Bedrag_Debet: 1665.54, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "Huur januari",
      Boeking_Grootboek_A: "1010", Boeking_Grootboek_B: "1010", Boeking_Saldo: "#REF!",
    },
    {
      Bedrijfsnr: "070", Boekstuk_Sleutel: "070420024002", Boeking_Dagboeknr: "20",
      Boeking_Boekjaar: 2024, Boeking_Boekperiode: "02", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000001",
      Boeking_Boekdatum: "01-02-2024", Boeking_Grootboeknr: "8000", Boeking_Kostenplaatsnr: null,
      Boeking_Complexnr: "01", Boeking_Unitnr: "001", Boeking_Contractnr: "C1", Boeking_Huurdernr: "H1",
      Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 250, Boeking_Omschrijving: "Beheervergoeding",
      Boeking_Grootboek_A: "8000", Boeking_Grootboek_B: "8000", Boeking_Saldo: "#REF!",
    },
    {
      Bedrijfsnr: "074", Boekstuk_Sleutel: "074420024001", Boeking_Dagboeknr: "20",
      Boeking_Boekjaar: 2024, Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001",
      Boeking_Boekdatum: "01-01-2024", Boeking_Grootboeknr: "1010", Boeking_Kostenplaatsnr: null,
      Boeking_Complexnr: "02", Boeking_Unitnr: "005", Boeking_Contractnr: "C9", Boeking_Huurdernr: "H9",
      Boeking_Bedrag_Debet: 3200, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "Huur januari Fergagne",
      Boeking_Grootboek_A: "1010", Boeking_Grootboek_B: "1010", Boeking_Saldo: "#REF!",
    },
  ];
}

export function balansRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Jaar: 2024, Grootboekrekeningnr: "1300", Beginbalans_debet: "50000.00", Beginbalans_credit: "0",
      Saldo_debet: "12000.00", Saldo_credit: "0", Eindsaldo_debet: null, Eindsaldo_credit: null,
      Eindsaldo: "-1487022.79", Rekening_omschrijving: "Bank", Balans_vw: "Balans",
    },
    {
      Bedrijfsnr: "074", Jaar: 2024, Grootboekrekeningnr: "1300", Beginbalans_debet: "20000.00", Beginbalans_credit: "0",
      Saldo_debet: "5000.00", Saldo_credit: "0", Eindsaldo_debet: null, Eindsaldo_credit: null,
      Eindsaldo: "25000.00", Rekening_omschrijving: "Bank", Balans_vw: "Balans",
    },
  ];
}

export function servicekostenRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Service_BK_Boekjaar: 2024, Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
      Service_BK_Boekstuknummer: "000003", Service_BK_Volgnummer: "000001", Service_BK_Complexnummer: "01",
      Service_BK_Unitnummer: "001", Service_BK_Contractnummer: "C1", Huurdernummer: "H1",
      Service_BK_Kostensoort: "0014", Kostensoort_omschrijving: "Onderhoud", Service_BK_Omschrijving: "Onderhoud dak",
      Service_BK_Bedrag_debet: "67.5", Service_BK_Bedrag_credit: "0", Service_BK_Doorbelasten: "Ja",
    },
    {
      Bedrijfsnr: "070", Service_BK_Boekjaar: 2024, Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
      Service_BK_Boekstuknummer: "000004", Service_BK_Volgnummer: "000001", Service_BK_Complexnummer: "01",
      Service_BK_Unitnummer: "001", Service_BK_Contractnummer: "C1", Huurdernummer: "H1",
      Service_BK_Kostensoort: "9600", Kostensoort_omschrijving: "Afrekening vorig jaar", Service_BK_Omschrijving: "Serviceafrekening 2023",
      Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "500", Service_BK_Doorbelasten: "Nee",
    },
    {
      Bedrijfsnr: "074", Service_BK_Boekjaar: 2024, Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
      Service_BK_Boekstuknummer: "000010", Service_BK_Volgnummer: "000001", Service_BK_Complexnummer: "02",
      Service_BK_Unitnummer: "005", Service_BK_Contractnummer: "C9", Huurdernummer: "H9",
      Service_BK_Kostensoort: "0020", Kostensoort_omschrijving: "Energie", Service_BK_Omschrijving: "Elektra",
      Service_BK_Bedrag_debet: "151.24", Service_BK_Bedrag_credit: "0", Service_BK_Doorbelasten: "Nee",
    },
  ];
}

export function rentrollRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "001", Complexnummer: "01",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "19986,48", Korting_bedrag_jaar: "-200",
      Service_voorschot_jaar: "1200,00", Gehuurd_oppervlak: "120,5", Contract_expiratiedatum: "31-12-2027",
      Contract_opzegdatum: null,
    },
    {
      Bedrijfsnummer: "074", Contractnummer: "C9", Vorderingsoort: "01", Unitnummer: "005", Complexnummer: "02",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "38400,00", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: "2400,00", Gehuurd_oppervlak: "250,0", Contract_expiratiedatum: "31-12-2026",
      Contract_opzegdatum: null,
    },
  ];
}

export function contractenRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Contract: "C1", Complexnummer: "01", Unitnummer: "001", Huurdernummer: "H1",
      Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2027", Expiratie_Opzegdatum: null, Expiratie_Aantal_per_optie: 5,
      Expiratie_huidige: "Ja",
    },
    {
      Bedrijfsnr: "074", Contract: "C9", Complexnummer: "02", Unitnummer: "005", Huurdernummer: "H9",
      Ingangsdatum: "01-06-2021", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2026", Expiratie_Opzegdatum: null, Expiratie_Aantal_per_optie: 3,
      Expiratie_huidige: "Ja",
    },
  ];
}

export function unitsRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Complexnummer: "01", Unitnummer: "001", Unit_Non_actief: "Nee",
      Unitomschrijving: "Bedrijfsruimte A", Unitsoort: "Kantoor", Unit_VVO: "120.5", Unit_BVO: "135.0",
      Unit_Adres: "Hoofdstraat 1", Unit_Postcode: "5462 GG", Unit_Plaats: "Veghel",
    },
    {
      Bedrijfsnr: "074", Complexnummer: "02", Unitnummer: "005", Unit_Non_actief: "Nee",
      Unitomschrijving: "Kantoorruimte B", Unitsoort: "Kantoor", Unit_VVO: "250.0", Unit_BVO: "270.0",
      Unit_Adres: "Zijstraat 5", Unit_Postcode: "5461 AA", Unit_Plaats: "Veghel",
    },
  ];
}

export function complexTotalenRijen(): Record<string, unknown>[] {
  return [
    { Bedrijfsnr: "070", Complexnr: "01", Totaal_Oppervlakte: "120,5", Totaal_Verhuurd: "120,5", Totaal_Leegstand: "0" },
    { Bedrijfsnr: "074", Complexnr: "02", Totaal_Oppervlakte: "250,0", Totaal_Verhuurd: "250,0", Totaal_Leegstand: "0" },
  ];
}

export function ouderdomsanalyseRijen(): Record<string, unknown>[] {
  return [
    {
      Bedrijfsnr: "070", Huurdernr: "H1", Achterstand: "500,00", Achterstand_tm_30_dagen: "500,00",
      Achterstand_tm_60_dagen: "0", Achterstand_tm_90_dagen: "0", Achterstand_90plus_dagen: "0",
      Vooruitbetaling: "0", Saldo: "500,00",
    },
    {
      Bedrijfsnr: "074", Huurdernr: "H9", Achterstand: "0", Achterstand_tm_30_dagen: "0",
      Achterstand_tm_60_dagen: "0", Achterstand_tm_90_dagen: "0", Achterstand_90plus_dagen: "0",
      Vooruitbetaling: "-150,00", Saldo: "150,00",
    },
  ];
}

/** Instellingen-tabblad heeft een herhaalde titelrij vóór "Veld,Waarde" (headerRowIndex 1) — zie begroting.ts. */
export function begrotingInstellingenRijen(bedrijfsnr: string, boekjaar: number): Record<string, unknown>[] {
  return [
    { A: "BVC Begroting v0.2 — algemene gegevens" },
    { Veld: "Veld", Waarde: "Waarde" },
    { Veld: "Administratiecode", Waarde: bedrijfsnr },
    { Veld: "Administratienaam", Waarde: `Testadministratie ${bedrijfsnr}` },
    { Veld: "Boekjaar", Waarde: String(boekjaar) },
    { Veld: "Begrotingsversie", Waarde: "v0.2" },
    { Veld: "Status", Waarde: "Concept" },
  ];
}

export function begrotingExploitatieRijen(): Record<string, unknown>[] {
  return [
    { A: "Exploitatie Eigenaarsexploitatie" },
    {
      mapping_code: "mapping_code", onderdeel: "onderdeel", rapportregel: "rapportregel", tekenregel: "tekenregel",
      invoermethode: "invoermethode", q1_invoer: "q1_invoer", q2_invoer: "q2_invoer", q3_invoer: "q3_invoer",
      q4_invoer: "q4_invoer", jaar_invoer: "jaar_invoer", budget_fy: "budget_fy",
    },
    {
      mapping_code: "PL_HUUR_BELAST", onderdeel: "P&L - Opbrengsten", rapportregel: "Huuropbrengst belast",
      tekenregel: "POSITIEF", invoermethode: "KWARTAAL", q1_invoer: "139,152", q2_invoer: "130,321",
      q3_invoer: "128,610", q4_invoer: "128,610", jaar_invoer: null, budget_fy: "526,693",
    },
    {
      mapping_code: "PL_HUURKORTING", onderdeel: "P&L - Opbrengsten", rapportregel: "Verleende huurkorting",
      tekenregel: "NEGATIEF", invoermethode: "KWARTAAL", q1_invoer: "(7,086)", q2_invoer: "(4,682)",
      q3_invoer: "(3,480)", q4_invoer: "(3,480)", jaar_invoer: null, budget_fy: "(18,728)",
    },
    {
      mapping_code: "PL_ZONNESTROOM", onderdeel: "P&L - Opbrengsten", rapportregel: "Zonnestroom",
      tekenregel: "POSITIEF", invoermethode: "JAAR", q1_invoer: null, q2_invoer: null,
      q3_invoer: null, q4_invoer: null, jaar_invoer: null, budget_fy: "#VALUE!",
    },
  ];
}

export function begrotingServicekostenRijen(): Record<string, unknown>[] {
  return [
    { A: "Servicekosten Servicekostenbegroting" },
    {
      mapping_code: "mapping_code", recordtype: "recordtype", complex_code: "complex_code", kostensoort: "kostensoort",
      tekenregel: "tekenregel", invoermethode: "invoermethode", q1_invoer: "q1_invoer", q2_invoer: "q2_invoer",
      q3_invoer: "q3_invoer", q4_invoer: "q4_invoer", jaar_invoer: "jaar_invoer", budget_fy: "budget_fy", toelichting: "toelichting",
    },
    {
      mapping_code: "SC_ONDERHOUD_VERLICHTING", recordtype: "KOSTENSOORT", complex_code: "ALLE_COMPLEXEN",
      kostensoort: "Onderhoud verlichting", tekenregel: "NEGATIEF", invoermethode: "JAAR",
      q1_invoer: null, q2_invoer: null, q3_invoer: null, q4_invoer: null, jaar_invoer: "(757)",
      budget_fy: "(757)", toelichting: "Onderhoud verlichting",
    },
  ];
}

/**
 * De grootboekmapping voor `070_Rooise_Zoom`, bevestigd door de gebruiker
 * door het Controlerapport (rauwe cachedata) te vergelijken met de
 * bestaande Q2-2026-rapportage, vervolgens expliciet GOEDGEKEURD met een
 * bevestigde tekenconventie per rekening (2026-08-17), en aangevuld met de
 * BALANS-rekeningen die `pl-periode` in de praktijk als `controleVereist`
 * naar boven bracht — bevestigd tegen het echte rekeningschema
 * ("Rekeningschema basisgegevens", Srt-kolom Bal/V&W) van bedrijf 070
 * (2026-08-18), en per 2026-08-19 aangevuld met een vaste `balanszijde`
 * (ACTIVA/PASSIVA) per BALANS-regel — 10 van de 13 op basis van
 * ondubbelzinnige boekhoudkundige terminologie/de door de gebruiker
 * gegeven categorieregels (bank/debiteuren→ACTIVA,
 * crediteuren/voorzieningen/eigen vermogen→PASSIVA), 3 nog `null`
 * (Afdrachten BTW/Tussenrekening servicekst/Betaalde Service kosten —
 * genuine onduidelijk, niet geraden). Zie packages/config/README.md voor de
 * volledige toelichting per rekening. Dient hier als representatieve
 * fixture voor tests; is NIET
 * automatisch de mapping die `070_Rooise_Zoom` in productie gebruikt — dat
 * vereist het bestand handmatig naar
 * `<BVC_DATA_ROOT>/config/grootboekmappingen/070_Rooise_Zoom.json` te
 * kopiëren (CLAUDE.md §5: data blijft buiten git).
 */
export function rooiseZoomGrootboekMapping(): GrootboekMappingConfig {
  const resultaatRekeningen: [string, string, string, "ZOALS_BRON" | "OMGEKEERD"][] = [
    ["4000", "Beheerkosten", "Kosten", "ZOALS_BRON"],
    ["4130", "Verzekeringen", "Kosten", "ZOALS_BRON"],
    ["4300", "Onderhoud gebouwen", "Kosten", "ZOALS_BRON"],
    ["4330", "Onderhoud terrein", "Kosten", "ZOALS_BRON"],
    ["4340", "Onderhoud installaties", "Kosten", "ZOALS_BRON"],
    ["4350", "Servicekosten eigenaar", "Kosten", "ZOALS_BRON"],
    ["4700", "WOZ / OZB", "Kosten", "ZOALS_BRON"],
    ["4710", "Gemeentelijke heffingen", "Kosten", "ZOALS_BRON"],
    ["4903", "Niet verrekenbare BTW", "Kosten", "ZOALS_BRON"],
    ["4990", "Diverse algemene kosten", "Kosten", "ZOALS_BRON"],
    ["8800", "Huuropbrengsten belast", "Opbrengsten", "OMGEKEERD"],
    ["8801", "Huuropbrengsten onbelast", "Opbrengsten", "OMGEKEERD"],
    ["8805", "Verleende huurkorting", "Opbrengsten", "OMGEKEERD"],
    ["8815", "Zonnestroom", "Opbrengsten", "OMGEKEERD"],
  ];

  // Rekeningnummer + omschrijving (documentatie) + balanszijde uit het rekeningschema.
  // balanszijde `null` = nog niet bevestigd (geen classificatie geraden op omschrijving,
  // zie packages/config/README.md's "Balanszijde 070_Rooise_Zoom" voor de per-rekening
  // onderbouwing/openstaande vragen).
  const balansRekeningen: [string, string, "ACTIVA" | "PASSIVA" | null][] = [
    ["0840", "Ontrekkingen - Uitkeringen", "PASSIVA"],
    ["0901", "Voorziening onderhoud Zoom 1", "PASSIVA"],
    ["0902", "Voorziening onderhoud Zoom 2", "PASSIVA"],
    ["0903", "Voorziening onderhoud Zoom 3", "PASSIVA"],
    ["1010", "Bank NL44RABO 0337 7344 45", "ACTIVA"],
    ["1310", "Huurdebiteuren", "ACTIVA"],
    ["1400", "Te ontvangen vergoedingen", "ACTIVA"],
    ["1410", "Vooruitbetaalde kosten", "ACTIVA"],
    ["1506", "Afdrachten BTW", null],
    ["1600", "Crediteuren", "PASSIVA"],
    ["1700", "Te betalen kosten", "PASSIVA"],
    ["1711", "Tussenrekening servicekst", null],
    ["1712", "Betaalde Service kosten", null],
  ];

  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [
      ...resultaatRekeningen.map(([grootboekrekening, rapportagepost, rapportagecategorie, tekenconventie]) => ({
        grootboekrekening,
        soort: "RESULTAAT" as const,
        rapportagepost,
        rapportagecategorie,
        tekenconventie,
        actief: true,
        status: "GOEDGEKEURD" as const,
      })),
      ...balansRekeningen.map(([grootboekrekening, , balanszijde]) => ({
        grootboekrekening,
        soort: "BALANS" as const,
        balanszijde,
        actief: true,
        status: balanszijde === null ? ("VOORGESTELD" as const) : ("GOEDGEKEURD" as const),
      })),
    ],
  };
}
