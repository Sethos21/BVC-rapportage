import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Gepland onderhoud (2026-09-04), fase 1: UITSLUITEND de pure
 * rekenlaag, conform OB-027 (`FO_Exploitatiebegroting_v1.0.md`) en de
 * businessbesluiten GO-001 t/m GO-006.
 *
 * Architectuurgrens (zelfde als Module 1/2/3): geen cache/SQLite/Excel/
 * bestanden/klok/IO/renderer/CLI. Signatuur is uitsluitend: expliciete
 * begrotingsinvoer per activiteit + module-brede aannames → berekende
 * uitkomst. Geen historische-realisatiekoppeling (GO-006: gepland versus
 * correctief/dagelijks is een expliciete gebruikersclassificatie, nooit uit
 * de boekhouding afgeleid — deze module leest dan ook geen boekhouding).
 *
 * REKENKUNDIG ONGELDIG VERSUS FUNCTIONEEL ONVOLLEDIG (businessbeslissing,
 * 2026-09-04 — kernonderscheid van deze module, corrigeert een eerder
 * technisch-ontwerpvoorstel dat bij ELKE hard-validatiefout de volledige
 * activiteit naar €0 herleidde):
 *
 * 1. Een ONTBREKEND/ONGELDIG functioneel veld (complexnummer, omschrijving,
 *    aanleidingType, aanleidingToelichting, status) levert een KRITIEK
 *    control op die later VASTSTELLEN moet blokkeren, maar verandert de
 *    financiële Q1-Q4/jaartotaal-bedragen NIET. Een administratieve fout
 *    mag het financiële conceptresultaat niet stilzwijgend wijzigen als de
 *    bedragen zelf geldig zijn — de gebruiker moet tijdens het concept
 *    kunnen blijven zien wat een activiteit financieel voorstelt, ook als
 *    hij nog niet volledig is ingevuld.
 * 2. Een REKENKUNDIG ONGELDIG kwartaalbedrag (NaN-Decimal) levert een
 *    KRITIEK control op EN krijgt een veilige 0-bijdrage — maar uitsluitend
 *    voor DAT ene kwartaal. De overige, wél geldige kwartaalbedragen van
 *    dezelfde activiteit blijven onaangetast (nooit de hele activiteit naar
 *    €0 vanwege één ongeldig kwartaal — dat zou een reëel bedrag in de
 *    andere kwartalen ten onrechte laten verdwijnen).
 * 3. Een NEGATIEF kwartaalbedrag is GELDIG (GO-001): levert een
 *    WAARSCHUWING op, telt volledig en ongewijzigd mee — nooit naar 0
 *    herleid.
 *
 * Hieruit volgt: `controleVereist` (gefilterd op `activiteitIndex` en
 * `ernst === "KRITIEK"`) is de ENIGE, authoritative validatie-uitkomst voor
 * "is deze activiteit functioneel compleet". Er is bewust GEEN aparte
 * `geldig`/`berekenbaar`-boolean op `BgGeplandOnderhoudActiviteitUitkomst`:
 * omdat een functionele fout de bedragen niet meer beïnvloedt, zou zo'n
 * boolean ofwel altijd `true` zijn (bedragen zijn altijd berekenbaar, zie
 * punt 2) ofwel een tweede, potentieel inconsistente representatie van
 * dezelfde informatie die al in `controleVereist` staat. Eén bestaande
 * controlstructuur volstaat (zelfde principe als Module 1/3: `controleVereist`
 * is de validatiesurface, geen parallelle vlaggen).
 *
 * REVIEW EN INVOERVALIDATIE ZIJN ONAFHANKELIJKE DIMENSIES (GO-003): `beoordeeld`
 * is pure doorgegeven invoer, nooit afgeleid uit `activiteiten.length` of uit
 * de aanwezigheid van KRITIEKE controls. `beoordeeld = true` betekent NIET
 * automatisch "alle invoer is geldig" — een spätere VASTSTELLEN-laag (hier
 * NIET gebouwd) heeft minimaal twee onafhankelijke voorwaarden nodig:
 * `resultaat.beoordeeld === true` EN afwezigheid van KRITIEKE controls in
 * `resultaat.controleVereist`.
 *
 * COMPLEXTOTALEN: een activiteit telt mee in `perComplex` zodra
 * `complexnummer` niet-leeg is, OOK als de activiteit verder functioneel
 * onvolledig is (bv. lege omschrijving) — het bedrag is dan nog steeds
 * eenduidig aan een complex toe te rekenen. Ontbreekt `complexnummer`, dan
 * telt het bedrag WEL mee in het modulebrede totaal (`totaalJaar`/
 * `kwartaalTotalen`) maar NIET in `perComplex`; `totaalZonderGeldigComplex`
 * maakt dat verschil expliciet reconcilieerbaar
 * (`totaalJaar === som(perComplex[].jaartotaal) + totaalZonderGeldigComplex`).
 * Groepering gebeurt uitsluitend op `complexnummer` (authoritative sleutel,
 * GO-005), nooit op een omschrijving.
 *
 * ACTIVITEITINDEX: `index` op `BgGeplandOnderhoudActiviteitUitkomst` en
 * `activiteitIndex` op `BgGeplandOnderhoudControleItem` zijn UITSLUITEND een
 * technische correlatiesleutel — de positie van de activiteit in de
 * invoerlijst van DEZE aanroep. Geen business-ID, geen persistence-ID; een
 * latere persistence-laag krijgt vermoedelijk een eigen, stabiele
 * identifier die dit vervangt.
 *
 * VASTE ENUMS (businessbeslissing 2026-09-04): `aanleidingType` en `status`
 * zijn bewust GEEN configureerbare/administratieafhankelijke mapping (in
 * tegenstelling tot bv. grootboekmapping, CLAUDE.md §3) — dit zijn
 * domeinwaarden van deze module zelf, geen bronclassificatie. Runtime-
 * validatie blijft nodig omdat TypeScript's compile-time typing een
 * ongeldige waarde aan een toekomstige (bv. JSON-)grens niet tegenhoudt.
 *
 * BUITEN SCOPE (fase 1, expliciet niet gebouwd — geen aanname):
 * persistence/SQLite, renderer/UI, CLI, historische realisatie/drilldown,
 * exploitatiekostensoort (hoort bij historische realisatie, niet bij de
 * begrotingsinvoer van een activiteit), mappingwijziging, automatische
 * rollover, automatische kwartaalverdeling, boeking-naar-activiteit-
 * koppeling, gepland/correctief-afleiding, overschrijdingswaarschuwing
 * (realisatie > begroting), VASTSTELLEN-/lifecyclelogica.
 */

export type BgGeplandOnderhoudStatus = "GEPLAND" | "IN_UITVOERING" | "UITGESTELD" | "VERVALLEN" | "AFGEROND" | "ONVOORZIEN";

export type BgGeplandOnderhoudAanleidingType = "MJOP" | "INSPECTIE" | "OFFERTE" | "ERVARING_BEHEERDER" | "OVERIG";

const GELDIGE_STATUSSEN: readonly BgGeplandOnderhoudStatus[] = ["GEPLAND", "IN_UITVOERING", "UITGESTELD", "VERVALLEN", "AFGEROND", "ONVOORZIEN"];
const GELDIGE_AANLEIDING_TYPES: readonly BgGeplandOnderhoudAanleidingType[] = ["MJOP", "INSPECTIE", "OFFERTE", "ERVARING_BEHEERDER", "OVERIG"];

/** Hergebruik van het gedeelde, neutrale controlevocabulaire (Module 1/3) — geen eigen ernst-schaal. */
export type BgGeplandOnderhoudControleErnst = BgControleErnst;

export interface BgGeplandOnderhoudControleItem {
  /** Positie van de betrokken activiteit in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één activiteit toe te wijzen. */
  activiteitIndex: number | null;
  ernst: BgGeplandOnderhoudControleErnst;
  bericht: string;
}

export interface BgGeplandOnderhoudActiviteitInvoer {
  complexnummer: string;
  omschrijving: string;
  aanleidingType: BgGeplandOnderhoudAanleidingType;
  aanleidingToelichting: string;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  status: BgGeplandOnderhoudStatus;
  leverancier?: string | null;
  offertebedrag?: Decimal | null;
  notitie?: string | null;
}

export interface BgGeplandOnderhoudAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
}

export type BgGeplandOnderhoudReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_ACTIVITIES" | "REVIEWED_WITH_ACTIVITIES";

export interface BgGeplandOnderhoudActiviteitUitkomst {
  index: number;
  /** De oorspronkelijke invoer — traceerbaarheid (OB-023-achtig principe, zelfde als Module 3's `invoer`). Kan een NaN-Decimal of ongeldige enumwaarde bevatten; zie `q1`-`q4` hieronder voor de veilige berekende waarden. */
  invoer: BgGeplandOnderhoudActiviteitInvoer;
  /** Veilige berekende kwartaalbedragen: een NaN-invoerwaarde is hier al naar 0 herleid (zie moduledoc punt 2), negatieve bedragen blijven ongewijzigd. */
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  jaartotaal: Decimal;
}

export interface BgGeplandOnderhoudKwartaalTotalen {
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

export interface BgGeplandOnderhoudComplexTotaal {
  complexnummer: string;
  aantalActiviteiten: number;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  jaartotaal: Decimal;
}

export interface BgGeplandOnderhoudResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van `aannames.beoordeeld` — nooit hier afgeleid. */
  beoordeeld: boolean;
  /** Afgeleide presentatietoestand (GO-003) — zie moduledoc. */
  reviewStatus: BgGeplandOnderhoudReviewStatus;
  activiteiten: BgGeplandOnderhoudActiviteitUitkomst[];
  kwartaalTotalen: BgGeplandOnderhoudKwartaalTotalen;
  totaalJaar: Decimal;
  /** Alleen activiteiten met een niet-leeg `complexnummer` — zie moduledoc "COMPLEXTOTALEN". */
  perComplex: BgGeplandOnderhoudComplexTotaal[];
  /** Som van `jaartotaal` van activiteiten zonder geldig complexnummer — houdt `totaalJaar` reconcilieerbaar met `perComplex`. */
  totaalZonderGeldigComplex: Decimal;
  controleVereist: BgGeplandOnderhoudControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isOngeldigDecimal(waarde: Decimal): boolean {
  return waarde.isNaN();
}

function leeg(waarde: string): boolean {
  return waarde.trim().length === 0;
}

/** Herleidt een rekenkundig ongeldig (NaN) bedrag naar een veilige 0-bijdrage; negatieve bedragen blijven ongewijzigd (moduledoc punt 2/3). */
function veiligBedrag(waarde: Decimal): Decimal {
  return isOngeldigDecimal(waarde) ? new Decimal(0) : waarde;
}

function valideerActiviteit(invoer: BgGeplandOnderhoudActiviteitInvoer, index: number): BgGeplandOnderhoudControleItem[] {
  const controleVereist: BgGeplandOnderhoudControleItem[] = [];
  const meld = (bericht: string, ernst: BgGeplandOnderhoudControleErnst = "KRITIEK") =>
    controleVereist.push({ activiteitIndex: index, ernst, bericht });

  if (leeg(invoer.complexnummer)) {
    meld(`Activiteit ${index}: complexnummer ontbreekt — verplicht voor vaststellen; bedrag telt wel mee in het modulebrede totaal, niet in complextotalen.`);
  }
  if (leeg(invoer.omschrijving)) {
    meld(`Activiteit ${index}: omschrijving ontbreekt — verplicht voor vaststellen.`);
  }
  if (!GELDIGE_AANLEIDING_TYPES.includes(invoer.aanleidingType)) {
    meld(`Activiteit ${index}: aanleidingType "${String(invoer.aanleidingType)}" is geen geldige waarde — verplicht voor vaststellen.`);
  }
  if (leeg(invoer.aanleidingToelichting)) {
    meld(`Activiteit ${index}: aanleidingToelichting ontbreekt — verplicht voor vaststellen.`);
  }
  if (!GELDIGE_STATUSSEN.includes(invoer.status)) {
    meld(`Activiteit ${index}: status "${String(invoer.status)}" is geen geldige waarde — verplicht voor vaststellen.`);
  }

  (["q1", "q2", "q3", "q4"] as const).forEach((veld) => {
    const waarde = invoer[veld];
    if (isOngeldigDecimal(waarde)) {
      meld(`Activiteit ${index}: ${veld.toUpperCase()} is geen geldig getal (NaN) — veilige bijdrage 0 toegepast, overige kwartalen blijven behouden.`);
    } else if (waarde.isNegative()) {
      meld(`Activiteit ${index}: ${veld.toUpperCase()} is negatief (${waarde.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
  });

  return controleVereist;
}

function berekenActiviteit(
  invoer: BgGeplandOnderhoudActiviteitInvoer,
  index: number,
): { uitkomst: BgGeplandOnderhoudActiviteitUitkomst; controleVereist: BgGeplandOnderhoudControleItem[] } {
  const controleVereist = valideerActiviteit(invoer, index);
  const q1 = veiligBedrag(invoer.q1);
  const q2 = veiligBedrag(invoer.q2);
  const q3 = veiligBedrag(invoer.q3);
  const q4 = veiligBedrag(invoer.q4);
  return { uitkomst: { index, invoer, q1, q2, q3, q4, jaartotaal: som([q1, q2, q3, q4]) }, controleVereist };
}

export function berekenBegroteGeplandOnderhoud(
  activiteitenInvoer: readonly BgGeplandOnderhoudActiviteitInvoer[],
  aannames: BgGeplandOnderhoudAannames,
): BgGeplandOnderhoudResultaat {
  const controleVereist: BgGeplandOnderhoudControleItem[] = [];
  const activiteiten: BgGeplandOnderhoudActiviteitUitkomst[] = activiteitenInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenActiviteit(invoer, index);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const kwartaalTotalen: BgGeplandOnderhoudKwartaalTotalen = {
    q1: som(activiteiten.map((a) => a.q1)),
    q2: som(activiteiten.map((a) => a.q2)),
    q3: som(activiteiten.map((a) => a.q3)),
    q4: som(activiteiten.map((a) => a.q4)),
  };
  const totaalJaar = som([kwartaalTotalen.q1, kwartaalTotalen.q2, kwartaalTotalen.q3, kwartaalTotalen.q4]);

  const perComplexMap = new Map<string, { aantalActiviteiten: number; q1: Decimal; q2: Decimal; q3: Decimal; q4: Decimal; jaartotaal: Decimal }>();
  let totaalZonderGeldigComplex = new Decimal(0);
  for (const activiteit of activiteiten) {
    const complexnummer = activiteit.invoer.complexnummer.trim();
    if (complexnummer.length === 0) {
      totaalZonderGeldigComplex = totaalZonderGeldigComplex.plus(activiteit.jaartotaal);
      continue;
    }
    const bestaand = perComplexMap.get(complexnummer);
    if (bestaand) {
      bestaand.aantalActiviteiten += 1;
      bestaand.q1 = bestaand.q1.plus(activiteit.q1);
      bestaand.q2 = bestaand.q2.plus(activiteit.q2);
      bestaand.q3 = bestaand.q3.plus(activiteit.q3);
      bestaand.q4 = bestaand.q4.plus(activiteit.q4);
      bestaand.jaartotaal = bestaand.jaartotaal.plus(activiteit.jaartotaal);
    } else {
      perComplexMap.set(complexnummer, {
        aantalActiviteiten: 1,
        q1: activiteit.q1,
        q2: activiteit.q2,
        q3: activiteit.q3,
        q4: activiteit.q4,
        jaartotaal: activiteit.jaartotaal,
      });
    }
  }
  const perComplex: BgGeplandOnderhoudComplexTotaal[] = Array.from(perComplexMap.entries())
    .map(([complexnummer, totalen]) => ({ complexnummer, ...totalen }))
    .sort((a, b) => a.complexnummer.localeCompare(b.complexnummer));

  const reviewStatus: BgGeplandOnderhoudReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : activiteiten.length === 0
      ? "REVIEWED_ZERO_ACTIVITIES"
      : "REVIEWED_WITH_ACTIVITIES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    activiteiten,
    kwartaalTotalen,
    totaalJaar,
    perComplex,
    totaalZonderGeldigComplex,
    controleVereist,
  };
}
