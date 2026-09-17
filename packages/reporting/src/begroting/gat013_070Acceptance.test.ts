import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkBeheerViaCentraleMapping, type BeheerRuweBoekingRegel } from "./beheerCentraleMapping.js";
import { beheerWerkelijkNaarPnLBovenEbitdaRegels } from "./beheerWerkelijkPnLAdapter.js";
import { berekenWerkelijkOnderhoudViaCentraleMapping, type OnderhoudRuweBoekingRegel } from "./onderhoudCentraleMapping.js";
import { onderhoudWerkelijkNaarPnLBovenEbitdaRegels } from "./onderhoudWerkelijkPnLAdapter.js";
import { berekenWerkelijkVerzekeringenViaCentraleMapping, type VerzekeringRuweBoekingRegel } from "./verzekeringCentraleMapping.js";
import { verzekeringWerkelijkNaarPnLBovenEbitdaRegels } from "./verzekeringWerkelijkPnLAdapter.js";
import { berekenWerkelijkGemeentelijkeLastenViaCentraleMapping, type GemeentelijkeLastenRuweBoekingRegel } from "./gemeentelijkeLastenCentraleMapping.js";
import { gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels } from "./gemeentelijkeLastenWerkelijkPnLAdapter.js";
import { berekenWerkelijkAlgemeneKostenViaCentraleMapping, type AlgemeneKostenRuweBoekingRegel } from "./algemeneKostenCentraleMapping.js";
import { algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels } from "./algemeneKostenWerkelijkPnLAdapter.js";
import { berekenWerkelijkHuurViaCentraleMapping, type HuurRuweBoekingRegel } from "./huurCentraleMapping.js";
import { huurWerkelijkNaarPnLBovenEbitdaRegels } from "./huurWerkelijkPnLAdapter.js";
import { berekenWerkelijkServicekostenEigenaarViaCentraleMapping, type ServicekostenEigenaarRuweBoekingRegel } from "./servicekostenEigenaarCentraleMapping.js";
import { servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels } from "./servicekostenEigenaarWerkelijkPnLAdapter.js";
import { berekenPnLBoom, type PurePnLBronRegel, type PurePnLOnderEbitdaRegel } from "../pnlEngine.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE GAT-013 (2026-09-17, vervolg) — ACCEPTATIE BUILD: bewijst met ECHTE
 * boekingen van 070_Rooise_Zoom (2026, uit reeds beschikbare Worker-exports
 * — geen fictieve/legacy bedragen) dat de bestaande productieketen
 * (centrale mapping → Werkelijk-calculators → P&L-adapters → Pure P&L
 * Engine) over meerdere perioden correct end-to-end functioneert, en dat
 * Q1 + Q2 = H1 exact geldt per regel en per subtotaal.
 *
 * VERVOLG: Huur (GL8800/8801/8805, GAT-002B-productieketen) en Servicekosten
 * Eigenaar (GL4350, GAT-006-productieketen) zijn nu WEL bronbewezen (bron:
 * boekingen-huur-zonnestroom-ske-2026-070.json) — beide via hun bestaande,
 * ongewijzigde productie-Werkelijk-P&L-adapter. Zonnestroom (GL8815) heeft
 * in deze bron NUL boekingen — een bevestigde afwezigheid, geen ontbrekend
 * onderzoek — en wordt daarom `NIET_VAN_TOEPASSING` meegegeven, ONDER EBITDA
 * (canon-correctie, zie `pnlEngine.ts`-addendum).
 *
 * GEEN NIEUWE ARCHITECTUUR: alle centrale mapping/calculators/adapters
 * hieronder zijn de BESTAANDE, ongewijzigde productiefuncties. DELTA BUILD
 * (2026-09-17): de eerder test-lokale bewijs-adapters voor Onderhoud/
 * Verzekeringen/Gemeentelijke Lasten zijn vervangen door hun nieuwe, echte
 * productie-Werkelijk-P&L-adapters (`onderhoudWerkelijkPnLAdapter.ts`/
 * `verzekeringWerkelijkPnLAdapter.ts`/`gemeentelijkeLastenWerkelijkPnLAdapter.ts`).
 * Daarbij is ook geconstateerd en gecorrigeerd dat Algemene Kosten hier ten
 * onrechte nog een test-lokale bewijs-adapter gebruikte, terwijl de echte
 * productie-adapter (`algemeneKostenWerkelijkPnLAdapter.ts`, GAT-009) al
 * bestond — deze harness gebruikt nu voor GEEN van de zeven modules meer een
 * test-lokale bewijs-adapter; uitsluitend Zonnestroom (GL8815, structureel
 * NIET_VAN_TOEPASSING, geen module met een productieketen) behoudt zijn
 * bewijsregel.
 */

const AANGEMAAKT = new Date("2026-09-17T00:00:00.000Z");
const OP_SYSTEEMTIJDSTIP = new Date("2026-09-17T12:00:00.000Z");
const BEDRIJFSNR = "070";
const BOEKJAAR = 2026;

function mappingRegel(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
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

const MAPPING_BEHEER: PnLBronmappingRegel[] = [mappingRegel({ grootboekrekening: "4000", economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" })];
const MAPPING_ONDERHOUD: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4300", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_GEBOUWEN" }),
  mappingRegel({ grootboekrekening: "4330", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_TERREIN" }),
  mappingRegel({ grootboekrekening: "4340", economischeModule: "ONDERHOUD", economischeCategorie: "ONDERHOUD_INSTALLATIES" }),
];
const MAPPING_VERZEKERINGEN: PnLBronmappingRegel[] = [mappingRegel({ grootboekrekening: "4130", ogbKostensoort: "4131", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" })];
const MAPPING_GEMEENTELIJKE_LASTEN: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4700", ogbKostensoort: "4701", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" }),
  mappingRegel({ grootboekrekening: "4710", economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN" }),
];
const MAPPING_ALGEMENE_KOSTEN: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4990", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" }),
  mappingRegel({ grootboekrekening: "4990", ogbKostensoort: "4992", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN" }),
  mappingRegel({ grootboekrekening: "4990", ogbKostensoort: "4995", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN" }),
];
/** Bewezen 070-mapping (GAT-002B) — alle drie uitsluitend GL-default, exact zoals de brondata het draagt (GL8805 heeft in de bron GEEN OGB, zie bron-onderzoek). */
const MAPPING_HUUR: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "8800", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_BELAST" }),
  mappingRegel({ grootboekrekening: "8801", economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_ONBELAST" }),
  mappingRegel({ grootboekrekening: "8805", economischeModule: "HUUR", economischeCategorie: "VERLEENDE_HUURKORTING" }),
];
/** Bewezen 070-mapping (GAT-006) — GL4350/OGB4319 ("Servicekosten leegstand") -> SERVICEKOSTEN_LEEGSTAND, GEEN GL-default. */
const MAPPING_SERVICEKOSTEN_EIGENAAR: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4350", ogbKostensoort: "4319", economischeModule: "SERVICEKOSTEN_EIGENAAR", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" }),
];

// ── Echte 070-boekingen 2026, getagd met boekperiode (bron: reeds opgehaalde Worker-exports) ──

interface RuweRegel {
  periode: string;
  gl: string;
  ogb: string | null;
  ogbOms: string | null;
  complex: string | null;
  saldo: string;
}

/** Bron: rekeningactiviteit-4000-070-2026.json (GAT-002C-bronproof, hergebruikt). */
const BOEKINGEN_BEHEER: RuweRegel[] = [
  { periode: "03", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1979.17" },
  { periode: "03", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1148.41" },
  { periode: "06", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "1148.41" },
  { periode: "06", gl: "4000", ogb: null, ogbOms: null, complex: null, saldo: "2169.65" },
];

/** Bron: onderhoud-boekingen-2026.json. */
const BOEKINGEN_ONDERHOUD: RuweRegel[] = [
  { periode: "02", gl: "4300", ogb: "4313", ogbOms: "Wanden, gevels, kozijnen", complex: "004", saldo: "1125" },
  { periode: "02", gl: "4300", ogb: "4301", ogbOms: "Ondhoud daken", complex: "002", saldo: "248" },
  { periode: "03", gl: "4340", ogb: "4340", ogbOms: "onderhoud installaties", complex: "004", saldo: "628.09" },
  { periode: "01", gl: "4300", ogb: "4315", ogbOms: "Onderhoud riool / afvoer", complex: "003", saldo: "303.2" },
  { periode: "02", gl: "4330", ogb: "4330", ogbOms: "Onderhoud groen etc.", complex: "004", saldo: "2985.5" },
  { periode: "04", gl: "4300", ogb: "4310", ogbOms: "Divers klein onderhoud", complex: "004", saldo: "-1308.96" },
  { periode: "06", gl: "4300", ogb: "4310", ogbOms: "Divers klein onderhoud", complex: "004", saldo: "-47.19" },
];

/** Bron: verzekeringen-boekingen-2026.json. */
const BOEKINGEN_VERZEKERINGEN: RuweRegel[] = [
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "001", saldo: "482.61" },
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "002", saldo: "821.9" },
  { periode: "03", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "004", saldo: "1590.9" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "004", saldo: "1094" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "001", saldo: "482.6" },
  { periode: "06", gl: "4130", ogb: "4131", ogbOms: "Brand-/opstalverzekering", complex: "002", saldo: "708.74" },
];

/** Bron: gemeentelijke-lasten-boekingen-2026.json. */
const BOEKINGEN_GEMEENTELIJKE_LASTEN: RuweRegel[] = [
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
const BOEKINGEN_ALGEMENE_KOSTEN: RuweRegel[] = [
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
const BOEKINGEN_HUUR_BELAST: RuweRegel[] = [
  { periode: "01", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-71437.89" },
  { periode: "02", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34322.12" },
  { periode: "03", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34322.12" },
  { periode: "04", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-59264.61" },
  { periode: "05", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34464.93" },
  { periode: "06", gl: "8800", ogb: null, ogbOms: null, complex: null, saldo: "-34644.98" },
];
const BOEKINGEN_HUUR_ONBELAST: RuweRegel[] = [
  { periode: "01", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "02", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "03", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "04", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "05", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
  { periode: "06", gl: "8801", ogb: null, ogbOms: null, complex: null, saldo: "-14174.36" },
];
const BOEKINGEN_HUURKORTING: RuweRegel[] = [
  { periode: "01", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "02", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "03", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "04", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "2362" },
  { periode: "05", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "1160" },
  { periode: "06", gl: "8805", ogb: null, ogbOms: null, complex: null, saldo: "1160" },
];
/** Bron: boekingen-huur-zonnestroom-ske-2026-070.json — enige regel, periode 04, OGB4319 "Servicekosten leegstand". */
const BOEKINGEN_SERVICEKOSTEN_EIGENAAR: RuweRegel[] = [{ periode: "04", gl: "4350", ogb: "4319", ogbOms: "Servicekosten leegstand", complex: "003", saldo: "199.08" }];

function inBereik(periode: string, vanaf: string, tot: string): boolean {
  return periode >= vanaf && periode <= tot;
}

/**
 * Zonnestroom (GL8815) — CANON-CORRECTIE (GAT-013-vervolg, vastgelegd in
 * `pnlEngine.ts`-addendum): GEEN exploitatie-opbrengst, ONDER EBITDA, als
 * bijzondere opbrengst. Voor 070/2026 (Q1 t/m Q3-partieel) bevat de bron
 * NUL boekingen op GL8815 — een BEVESTIGDE afwezigheid (de brondata is wél
 * bevraagd, GL8815 stond in het opgehaalde bereik), geen ontbrekend
 * onderzoek. Daarom `NIET_VAN_TOEPASSING` (bedrag 0), NOOIT `ONBEKEND` en
 * NOOIT stilzwijgend weggelaten.
 */
function zonnestroomRegelBewijs(): PurePnLOnderEbitdaRegel {
  return { regelSleutel: "ZONNESTROOM", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: { status: "NIET_VAN_TOEPASSING", bedrag: new Decimal(0) } };
}

/**
 * DE PARAMETRISEERBARE 070-ACCEPTATIEHARNESS: uitsluitend het aangeleverde
 * periodebereik bepaalt de uitkomst — geen aparte rekenlogica per periode.
 */
function run070Acceptance(vanafPeriode: string, totPeriode: string) {
  const filter = (regels: RuweRegel[]) => regels.filter((r) => inBereik(r.periode, vanafPeriode, totPeriode));
  const invoer = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: totPeriode, opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };

  const beheerBoekingen: BeheerRuweBoekingRegel[] = filter(BOEKINGEN_BEHEER).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, saldo: new Decimal(r.saldo) }));
  const onderhoudBoekingen: OnderhoudRuweBoekingRegel[] = filter(BOEKINGEN_ONDERHOUD).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const verzekeringBoekingen: VerzekeringRuweBoekingRegel[] = filter(BOEKINGEN_VERZEKERINGEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const gemLastenBoekingen: GemeentelijkeLastenRuweBoekingRegel[] = filter(BOEKINGEN_GEMEENTELIJKE_LASTEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const algemeneKostenBoekingen: AlgemeneKostenRuweBoekingRegel[] = filter(BOEKINGEN_ALGEMENE_KOSTEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, saldo: new Decimal(r.saldo) }));
  const huurBoekingen: HuurRuweBoekingRegel[] = filter([...BOEKINGEN_HUUR_BELAST, ...BOEKINGEN_HUUR_ONBELAST, ...BOEKINGEN_HUURKORTING]).map((r) => ({
    grootboekrekening: r.gl,
    ogbKostensoort: r.ogb,
    ogbKostensoortOmschrijving: r.ogbOms,
    saldo: new Decimal(r.saldo),
  }));
  const skeBoekingen: ServicekostenEigenaarRuweBoekingRegel[] = filter(BOEKINGEN_SERVICEKOSTEN_EIGENAAR).map((r) => ({
    grootboekrekening: r.gl,
    ogbKostensoort: r.ogb,
    ogbKostensoortOmschrijving: r.ogbOms,
    complexnummer: r.complex,
    saldo: new Decimal(r.saldo),
  }));

  const beheer = berekenWerkelijkBeheerViaCentraleMapping(invoer, beheerBoekingen, MAPPING_BEHEER);
  const onderhoud = berekenWerkelijkOnderhoudViaCentraleMapping(invoer, onderhoudBoekingen, MAPPING_ONDERHOUD);
  const verzekering = berekenWerkelijkVerzekeringenViaCentraleMapping(invoer, verzekeringBoekingen, MAPPING_VERZEKERINGEN);
  const gemLasten = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(invoer, gemLastenBoekingen, MAPPING_GEMEENTELIJKE_LASTEN);
  const algemeneKosten = berekenWerkelijkAlgemeneKostenViaCentraleMapping(invoer, algemeneKostenBoekingen, MAPPING_ALGEMENE_KOSTEN);
  const huur = berekenWerkelijkHuurViaCentraleMapping(invoer, huurBoekingen, MAPPING_HUUR);
  const ske = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(invoer, skeBoekingen, MAPPING_SERVICEKOSTEN_EIGENAAR);

  const regels: PurePnLBronRegel[] = [
    ...huurWerkelijkNaarPnLBovenEbitdaRegels(huur.werkelijk, true),
    ...beheerWerkelijkNaarPnLBovenEbitdaRegels(beheer.werkelijk, true),
    ...onderhoudWerkelijkNaarPnLBovenEbitdaRegels(onderhoud.werkelijk, true),
    ...verzekeringWerkelijkNaarPnLBovenEbitdaRegels(verzekering.werkelijk, true),
    ...gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(gemLasten.werkelijk, true),
    ...algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(algemeneKosten.werkelijk, true),
    ...servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(ske.werkelijk, true),
    zonnestroomRegelBewijs(),
  ];

  const pnl = berekenPnLBoom("WERKELIJK", regels);

  return {
    pnl,
    nietGemapt: [...beheer.nietGemapt, ...onderhoud.nietGemapt, ...verzekering.nietGemapt, ...gemLasten.nietGemapt, ...algemeneKosten.nietGemapt, ...huur.nietGemapt, ...ske.nietGemapt],
    perModule: {
      huurBelast: huur.werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_BELAST")!.categorieTotaal,
      huurOnbelast: huur.werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_ONBELAST")!.categorieTotaal,
      huurkorting: huur.werkelijk.perCategorie.find((c) => c.categorie === "VERLEENDE_HUURKORTING")!.categorieTotaal,
      beheer: beheer.werkelijk.moduleTotaal,
      onderhoudGebouwen: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal,
      onderhoudTerrein: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_TERREIN")!.categorieTotaal,
      onderhoudInstallaties: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_INSTALLATIES")!.categorieTotaal,
      verzekeringen: verzekering.werkelijk.moduleTotaal,
      ozbWoz: gemLasten.werkelijk.perCategorie[0]!.categorieTotaal, // GEMEENTELIJKE_LASTEN is één categorie (OB-033) — GL4700+GL4710 samen
      algemeneKosten: algemeneKosten.werkelijk.moduleTotaal,
      servicekostenEigenaar: ske.werkelijk.moduleTotaal,
    },
  };
}

describe("GAT-013 — 070 Rooise Zoom multi-periode acceptatie (volledige P&L, echte 2026-boekingen)", () => {
  const q1 = run070Acceptance("01", "03");
  const q2 = run070Acceptance("04", "06");
  const h1 = run070Acceptance("01", "06");

  it("A. Huur (GAT-002B-keten): Q1/Q2 exact bronbewezen, legacy-match op hele euro's", () => {
    expect(q1.perModule.huurBelast.negated().toString()).toBe("140082.13");
    expect(q1.perModule.huurOnbelast.negated().toString()).toBe("42523.08");
    expect(q1.perModule.huurkorting.toString()).toBe("7086"); // ruw (nog niet genormaliseerd), legacy toont -7.086
    expect(q1.perModule.huurBelast.negated().toDecimalPlaces(0).toString()).toBe("140082"); // legacy 140.082
    expect(q1.perModule.huurOnbelast.negated().toDecimalPlaces(0).toString()).toBe("42523"); // legacy 42.523
    expect(q1.perModule.huurkorting.toDecimalPlaces(0).toString()).toBe("7086"); // legacy -7.086 (voor normalisatie)

    expect(q2.perModule.huurBelast.negated().toDecimalPlaces(0).toString()).toBe("128375"); // legacy 128.375 (exact 128374.52)
    expect(q2.perModule.huurOnbelast.negated().toDecimalPlaces(0).toString()).toBe("42523"); // legacy 42.523
    expect(q2.perModule.huurkorting.toDecimalPlaces(0).toString()).toBe("4682"); // legacy -4.682
  });

  it("B. Servicekosten Eigenaar (GAT-006-keten): Q1 €0, Q2 €199,08, H1 €199,08 — brondata bewijst SERVICEKOSTEN_LEEGSTAND, geen classificatie naar het legacy-bedrag toe", () => {
    expect(q1.perModule.servicekostenEigenaar.toString()).toBe("0");
    expect(q2.perModule.servicekostenEigenaar.toString()).toBe("199.08");
    expect(h1.perModule.servicekostenEigenaar.toString()).toBe("199.08");
    expect(q2.perModule.servicekostenEigenaar.toDecimalPlaces(0).toString()).toBe("199"); // legacy 199
  });

  it("C. Zonnestroom: NIET_VAN_TOEPASSING, onder EBITDA, geen euro-effect (bevestigde afwezigheid GL8815 in de bron)", () => {
    expect(h1.pnl.onderEbitda).toHaveLength(1);
    expect(h1.pnl.onderEbitda[0]!.regelSleutel).toBe("ZONNESTROOM");
    expect(h1.pnl.onderEbitda[0]!.waarde).toEqual({ status: "NIET_VAN_TOEPASSING", bedrag: new Decimal(0) });

    const zonderZonnestroom = berekenPnLBoom("WERKELIJK", [...huurWerkelijkNaarPnLBovenEbitdaRegels((berekenWerkelijkHuurViaCentraleMapping({ bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP }, [], MAPPING_HUUR)).werkelijk, true)]);
    expect(zonderZonnestroom.onderEbitda).toHaveLength(0); // bewijst dat de regel er alleen staat omdat de harness hem toevoegt, niet dat de engine hem verzint
  });

  it("D. volledige exploitatie-opbrengsten: Q1 exact, Q2 exact, H1 = Q1 + Q2 exact", () => {
    const opbrengstenQ1 = q1.perModule.huurBelast.negated().plus(q1.perModule.huurOnbelast.negated()).plus(q1.perModule.huurkorting.negated());
    const opbrengstenQ2 = q2.perModule.huurBelast.negated().plus(q2.perModule.huurOnbelast.negated()).plus(q2.perModule.huurkorting.negated());
    expect(q1.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(opbrengstenQ1.toString());
    expect(q2.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(opbrengstenQ2.toString());
    expect(h1.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(q1.pnl.totaalOpbrengsten.besteWetenSom.plus(q2.pnl.totaalOpbrengsten.besteWetenSom).toString());
    expect(h1.pnl.totaalOpbrengsten.besteWetenSom.toDecimalPlaces(0).toString()).toBe("341735"); // legacy 341.735
    expect(h1.pnl.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("E. volledige exploitatiekosten: H1 = Q1 + Q2 exact, en H1 sluit exact aan op de legacy-referentie (nu incl. Servicekosten Eigenaar)", () => {
    expect(h1.pnl.totaalKosten.besteWetenSom.toString()).toBe(q1.pnl.totaalKosten.besteWetenSom.plus(q2.pnl.totaalKosten.besteWetenSom).toString());
    const somModulesH1 = [h1.perModule.beheer, h1.perModule.onderhoudGebouwen, h1.perModule.onderhoudTerrein, h1.perModule.onderhoudInstallaties, h1.perModule.verzekeringen, h1.perModule.ozbWoz, h1.perModule.algemeneKosten, h1.perModule.servicekostenEigenaar].reduce(
      (t, v) => t.plus(v),
      new Decimal(0),
    );
    expect(h1.pnl.totaalKosten.besteWetenSom.toString()).toBe(somModulesH1.toString());
    expect(h1.pnl.totaalKosten.besteWetenSom.toDecimalPlaces(0).toString()).toBe("30555"); // legacy 30.555, nu volledig verklaard (was 30.356 zonder SKE)
    expect(h1.pnl.totaalKosten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("F/G. EBITDA: Q1 + Q2 = H1 exact; H1 is een exacte legacy-match, Q1/Q2 wijken elk €1 af door het bekende round-per-regel-vs-sum-dan-afronden-verschil (canon, geen fout)", () => {
    expect(h1.pnl.ebitda.bedrag.toString()).toBe(q1.pnl.ebitda.bedrag.plus(q2.pnl.ebitda.bedrag).toString());
    expect(h1.pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
    // Exact: Q1 151.041,81 (legacy 151.041, rondt legacy-methode-verschil van €1 — zie GAT-013-rapportage);
    // Q2 160.137,85 (legacy 160.139, zelfde €1-verschil, tegengesteld teken); de twee afrondingsverschillen
    // heffen elkaar in H1 exact op.
    expect(q1.pnl.ebitda.bedrag.toString()).toBe("151041.81");
    expect(q2.pnl.ebitda.bedrag.toString()).toBe("160137.85");
    expect(q1.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("151042"); // legacy 151.041 — €1 afrondingsverschil
    expect(q2.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("160138"); // legacy 160.139 — €1 afrondingsverschil, tegengesteld
    expect(h1.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("311180"); // legacy H1 EBITDA €311.180 — EXACTE match
    expect(new Decimal("151041").plus("160139").toString()).toBe("311180");
  });

  it("gemapte boekingen verdwijnen niet, geen niet-gemapte boekingen in deze bewezen bron", () => {
    expect(q1.nietGemapt).toEqual([]);
    expect(q2.nietGemapt).toEqual([]);
    expect(h1.nietGemapt).toEqual([]);
  });

  it("H1 module-totalen = Q1 + Q2 exact, per module (harde multi-periodecontrole)", () => {
    (Object.keys(q1.perModule) as (keyof typeof q1.perModule)[]).forEach((sleutel) => {
      expect(h1.perModule[sleutel].toString()).toBe(q1.perModule[sleutel].plus(q2.perModule[sleutel]).toString());
    });
  });
});
