import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE DELTA (2026-09-18, "Pure P&L → Worker + Renderer") — de bewezen,
 * ECHTE 070_Rooise_Zoom-bronmapping/-boekingen uit GAT-013, GEËXTRAHEERD
 * naar een gedeeld bestand zodat zowel `gat013_070Acceptance.test.ts`
 * (het bestaande, ongewijzigde financiële bewijs) als
 * `pnlPeriodeOrchestratie.test.ts` (het NIEUWE risico: reproduceert de
 * orchestratielaag exact dezelfde H1-uitkomst?) dezelfde brondata gebruiken
 * — geen tweede kopie van ~150 regels echte boekingen, geen risico dat de
 * twee testbestanden ongemerkt uit elkaar lopen.
 *
 * ZUIVERE VERPLAATSING, GEEN WIJZIGING: elke waarde hieronder is
 * BYTE-IDENTIEK aan wat voorheen inline in `gat013_070Acceptance.test.ts`
 * stond — zie dat bestand se eigen bronvermeldingen per array (Worker-
 * exports, GAT-002B/GAT-002C/GAT-006-bronproef) voor de herkomst.
 */

export const AANGEMAAKT = new Date("2026-09-17T00:00:00.000Z");
export const OP_SYSTEEMTIJDSTIP = new Date("2026-09-17T12:00:00.000Z");
export const BEDRIJFSNR = "070";
export const BOEKJAAR = 2026;

export function mappingRegel(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: BEDRIJFSNR,
    grootboekrekening: "0000",
    ogbKostensoort: null,
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "ALGEMENE_KOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

// ── Bewezen 070-bronmapping (2026, hergebruik bestaande centrale-mapping-architectuur) ──

export const MAPPING_BEHEER: PnLBronmappingRegel[] = [mappingRegel({ grootboekrekening: "4000", economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" })];
export const MAPPING_ONDERHOUD: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4300", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" }),
  mappingRegel({ grootboekrekening: "4330", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_TERREIN" }),
  mappingRegel({ grootboekrekening: "4340", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_INSTALLATIES" }),
];
export const MAPPING_VERZEKERINGEN: PnLBronmappingRegel[] = [mappingRegel({ grootboekrekening: "4130", ogbKostensoort: "4131", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" })];
export const MAPPING_GEMEENTELIJKE_LASTEN: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4700", ogbKostensoort: "4701", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" }),
  mappingRegel({ grootboekrekening: "4710", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" }),
];
export const MAPPING_ALGEMENE_KOSTEN: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" }),
  mappingRegel({ grootboekrekening: "4990", ogbKostensoort: "4992", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN" }),
  mappingRegel({ grootboekrekening: "4990", ogbKostensoort: "4995", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN" }),
];
/** Bewezen 070-mapping (GAT-002B) — alle drie uitsluitend GL-default, exact zoals de brondata het draagt (GL8805 heeft in de bron GEEN OGB, zie bron-onderzoek). */
export const MAPPING_HUUR: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "8800", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_BELAST" }),
  mappingRegel({ grootboekrekening: "8801", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_ONBELAST" }),
  mappingRegel({ grootboekrekening: "8805", economischeModule: "HUUR", economischeCategorie: "VERLEENDE_HUURKORTING" }),
];
/** Bewezen 070-mapping (GAT-006) — GL4350/OGB4319 ("Servicekosten leegstand") -> SERVICEKOSTEN_LEEGSTAND, GEEN GL-default. */
export const MAPPING_SERVICEKOSTEN_EIGENAAR: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4350", ogbKostensoort: "4319", economischeModule: "SERVICEKOSTEN_EIGENAAR", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" }),
];

/** Alle acht modules' mapping in één vlakke lijst — handig voor een orchestratielaag die ALLE 070-boekingen in één keer partitioneert (geen per-module bronselectie meer nodig). */
export const ALLE_MAPPING_070: PnLBronmappingRegel[] = [
  ...MAPPING_BEHEER,
  ...MAPPING_ONDERHOUD,
  ...MAPPING_VERZEKERINGEN,
  ...MAPPING_GEMEENTELIJKE_LASTEN,
  ...MAPPING_ALGEMENE_KOSTEN,
  ...MAPPING_HUUR,
  ...MAPPING_SERVICEKOSTEN_EIGENAAR,
];

// ── Echte 070-boekingen 2026, getagd met boekperiode (bron: reeds opgehaalde Worker-exports) ──

export interface RuweRegel {
  periode: string;
  gl: string;
  ogb: string | null;
  ogbOms: string | null;
  complex: string | null;
  saldo: string;
}

/** Bron: rekeningactiviteit-4000-070-2026.json (GAT-002C-bronproof, hergebruikt). */
export const BOEKINGEN_BEHEER: RuweRegel[] = [
  { periode: "03", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1979.17" },
  { periode: "03", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1148.41" },
  { periode: "06", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1148.41" },
  { periode: "06", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "2169.65" },
];

/** Bron: onderhoud-boekingen-2026.json. */
export const BOEKINGEN_ONDERHOUD: RuweRegel[] = [
  { periode: "02", gl: "4300", ogb: "4313", ogbOms: "Wanden, gevels, kozijnen", complex: "004", saldo: "1125" },
  { periode: "02", gl: "4300", ogb: "4301", ogbOms: "Ondhoud daken", complex: "002", saldo: "248" },
  { periode: "03", gl: "4340", ogb: "4340", ogbOms: "onderhoud installaties", complex: "004", saldo: "628.09" },
  { periode: "01", gl: "4300", ogb: "4315", ogbOms: "Onderhoud riool / afvoer", complex: "003", saldo: "303.2" },
  { periode: "02", gl: "4330", ogb: "4330", ogbOms: "Onderhoud groen etc.", complex: "004", saldo: "2985.5" },
  { periode: "04", gl: "4300", ogb: "4310", ogbOms: "Divers klein onderhoud", complex: "004", saldo: "-1308.96" },
  { periode: "06", gl: "4300", ogb: "4310", ogbOms: "Divers klein onderhoud", complex: "004", saldo: "-47.19" },
];

/** Bron: verzekeringen-boekingen-2026.json. */
export const BOEKINGEN_VERZEKERINGEN: RuweRegel[] = [
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "001", saldo: "482.61" },
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "002", saldo: "821.9" },
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "004", saldo: "1590.9" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "004", saldo: "1094" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "001", saldo: "482.6" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "002", saldo: "708.74" },
];

/** Bron: gemeentelijke-lasten-boekingen-2026.json. */
export const BOEKINGEN_GEMEENTELIJKE_LASTEN: RuweRegel[] = [
  { periode: "03", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "001", saldo: "-7.33" },
  { periode: "03", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "001", saldo: "7.33" },
  { periode: "02", gl: "4700", ogb: "4701", ogbOms: "OZB", complex: "003", saldo: "1817.65" },
  { periode: "02", gl: "4700", ogb: "4701", ogbOms: "OZB", complex: "002", saldo: "2301.93" },
  { periode: "02", gl: "4700", ogb: "4701", ogbOms: "OZB", complex: "001", saldo: "2438.47" },
  { periode: "02", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "003", saldo: "252.7" },
  { periode: "02", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "002", saldo: "320.03" },
  { periode: "02", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "001", saldo: "339.01" },
  { periode: "02", gl: "4700", ogb: "4701", ogbOms: "OZB", complex: "004", saldo: "2871.55" },
  { periode: "02", gl: "4700", ogb: "4701", ogbOms: "OZB", complex: "004", saldo: "1896.59" },
  { periode: "02", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "004", saldo: "399.22" },
  { periode: "02", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "004", saldo: "263.67" },
  { periode: "05", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "001", saldo: "256.14" },
  { periode: "05", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "002", saldo: "241.8" },
  { periode: "05", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "003", saldo: "190.93" },
  { periode: "05", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "001", saldo: "0.48" },
  { periode: "05", gl: "4710", ogb: "4710", ogbOms: "Gemeentelijke heffingen", complex: "004", saldo: "756.73" },
];

/** Bron: boekingen-ogb-2026-070.json (GL4990). */
export const BOEKINGEN_ALGEMENE_KOSTEN: RuweRegel[] = [
  { periode: "01", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "06", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "07", gl: "4990", ogb: "4992", ogbOms: "makelaarskosten", complex: "003", saldo: "250" },
  { periode: "02", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "03", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "05", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "07", gl: "4990", ogb: "4990", ogbOms: "Diverse alg kosten", complex: "001", saldo: "-150" },
  { periode: "02", gl: "4990", ogb: "4992", ogbOms: "makelaarskosten", complex: "002", saldo: "250" },
  { periode: "04", gl: "4990", ogb: "4991", ogbOms: "Afronding/betalingsversch", complex: "001", saldo: "-0.09" },
  { periode: "05", gl: "4990", ogb: "4990", ogbOms: "Diverse alg kosten", complex: "001", saldo: "175" },
  { periode: "06", gl: "4990", ogb: "4991", ogbOms: "Afronding/betalingsversch", complex: "001", saldo: "-0.37" },
  { periode: "03", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.45" },
  { periode: "06", gl: "4990", ogb: "4995", ogbOms: "Bankkosten", complex: "001", saldo: "3.9" },
];

/**
 * Bron: boekingen-huur-zonnestroom-ske-2026-070.json (121 individuele
 * boekingen, GL-default-classificatie — geen OGB-verfijning in de bron).
 * Hier PER PERIODE GEAGGREGEERD (som van de individuele regels, wiskundig
 * identiek aan boeking-voor-boeking classificeren — `berekenWerkelijkHuur`
 * sommeert toch uitsluitend per categorie) voor leesbaarheid; elk
 * periodetotaal is gecrosscheckt tegen het bestand se eigen
 * `perGrootboekrekening[].totaalSaldo` (GL8800 P01–P08 = -363.072,24;
 * GL8801 = -113.394,88; GL8805 = 14.088 — alle drie exact bevestigd).
 */
export const BOEKINGEN_HUUR_BELAST: RuweRegel[] = [
  { periode: "01", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-71437.89" },
  { periode: "02", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34322.12" },
  { periode: "03", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34322.12" },
  { periode: "04", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-59264.61" },
  { periode: "05", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34464.93" },
  { periode: "06", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34644.98" },
];
export const BOEKINGEN_HUUR_ONBELAST: RuweRegel[] = [
  { periode: "01", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "02", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "03", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "04", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "05", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "06", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
];
export const BOEKINGEN_HUURKORTING: RuweRegel[] = [
  { periode: "01", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "02", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "03", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "04", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "05", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "1160" },
  { periode: "06", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "1160" },
];
/** Bron: boekingen-huur-zonnestroom-ske-2026-070.json — enige regel, periode 04, OGB4319 "Servicekosten leegstand". */
export const BOEKINGEN_SERVICEKOSTEN_EIGENAAR: RuweRegel[] = [{ periode: "04", gl: "4350", ogb: "4319", ogbOms: "Servicekosten leegstand", complex: "003", saldo: "199.08" }];

/** Alle acht modules' boekingen in één vlakke lijst (H1 2026, periode 01-08 zoals bronbewezen) — voor een orchestratielaag die ALLE 070-boekingen in één keer partitioneert. */
export const ALLE_BOEKINGEN_070: RuweRegel[] = [
  ...BOEKINGEN_BEHEER,
  ...BOEKINGEN_ONDERHOUD,
  ...BOEKINGEN_VERZEKERINGEN,
  ...BOEKINGEN_GEMEENTELIJKE_LASTEN,
  ...BOEKINGEN_ALGEMENE_KOSTEN,
  ...BOEKINGEN_HUUR_BELAST,
  ...BOEKINGEN_HUUR_ONBELAST,
  ...BOEKINGEN_HUURKORTING,
  ...BOEKINGEN_SERVICEKOSTEN_EIGENAAR,
];

export function inBereik(periode: string, vanaf: string, tot: string): boolean {
  return periode >= vanaf && periode <= tot;
}
