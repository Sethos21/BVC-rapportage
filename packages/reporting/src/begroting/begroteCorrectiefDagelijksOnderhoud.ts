import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Correctief/Dagelijks onderhoud — OB-028 (2026-09-04), fase CD-P0:
 * UITSLUITEND de pure rekenlaag, conform het goedgekeurde technisch ontwerp
 * en de businessbesluiten OB028-001 t/m 007.
 *
 * Architectuurgrens (zelfde als Module 1/2/3 en Gepland Onderhoud): geen
 * cache/SQLite/Excel/bestanden/klok/IO/renderer/CLI. Signatuur is
 * uitsluitend: expliciete begrotingsinvoer per regel + module-brede
 * aannames → berekende uitkomst. Geen historische-realisatiekoppeling —
 * gepland versus correctief/dagelijks is een expliciete
 * gebruikersclassificatie, deze module leest dan ook geen boekhouding.
 *
 * BEWUST GEEN KLOON VAN GEPLAND ONDERHOUD (`begroteGeplandOnderhoud.ts`):
 * OB-028 kent een fundamenteel kleiner regelmodel — geen Q1-Q4 (één
 * jaarbedrag), geen status, geen aanleiding, geen leverancier/offertebedrag.
 * Waar hetzelfde principe wél van toepassing is (functioneel incompleet ≠
 * financieel onberekenbaar; `beoordeeld` onafhankelijk van regelmutaties;
 * `controleVereist` is de enige authoritative validatie-uitkomst) wordt dat
 * principe hergebruikt, niet de datastructuur.
 *
 * ONTBREKEND JAARBEDRAG (kernontwerpbeslissing, zie technisch-ontwerp-
 * rapport sectie D): `jaarbedrag: Decimal | null` — `null` is een
 * eersteklas concept-toestand ("nog niet ingevuld"), GEEN NaN-Decimal-
 * workaround zoals bij Q1-Q4 in Gepland Onderhoud. Reden: OB-028 heeft
 * precies één financieel hoofdveld, en "nog niet ingevuld" is daar een
 * natuurlijke, veelvoorkomende toestand die een eigen representatie
 * verdient — anders dan Q1-Q4, waar "ontbrekend" geen natuurlijk
 * één-veld-equivalent heeft. Een NaN-Decimal blijft daarnaast defensief
 * mogelijk (een aanroeper kan altijd een corrupte waarde meegeven) en
 * krijgt exact dezelfde behandeling als `null`: KRITIEK + veilige
 * 0-bijdrage.
 *
 * FUNCTIONEEL ONVOLLEDIG VERSUS FINANCIEEL ONBEREKENBAAR (zelfde principe
 * als Gepland Onderhoud): een ontbrekende/lege `omschrijving` levert een
 * KRITIEK-control op, maar verandert de financiële `jaarbedrag`-bijdrage
 * NIET. Een `null`/NaN `jaarbedrag` levert eveneens een KRITIEK-control op,
 * maar krijgt een veilige 0-bijdrage — de regel blijft altijd zichtbaar in
 * `regels[]`, nooit stil verwijderd uit het resultaat.
 *
 * COMPLEXNUMMER: `string | null`, waarbij `null` = NTB (nader te bepalen) —
 * dit is, ANDERS dan bij Gepland Onderhoud (waar een leeg complexnummer een
 * KRITIEK-control oplevert), een STRUCTUREEL GELDIGE toestand, expliciet
 * vastgesteld in OB028-003. Er is dan ook GEEN validatieregel op
 * `complexnummer` in deze module — geen check, geen control, geen
 * groepering (zie ook: bewust geen `perComplex`/`totaalZonderComplex`,
 * onderbouwd in het technisch-ontwerprapport sectie E — OB-028 vraagt hier
 * niet om, complex is optioneel, premature generalisatie wordt vermeden).
 *
 * REVIEW EN INVOERVALIDATIE ZIJN ONAFHANKELIJKE DIMENSIES (zelfde principe
 * als Gepland Onderhoud GO-003): `beoordeeld` is pure doorgegeven invoer,
 * nooit afgeleid uit `regels.length` of uit de aanwezigheid van KRITIEKE
 * controls.
 *
 * BUITEN SCOPE (fase CD-P0, expliciet niet gebouwd — geen aanname):
 * persistence/SQLite, renderer/UI, CLI, historische realisatie/drilldown,
 * exploitatiekostensoort/OGB, grootboekmapping, mappingwijziging,
 * automatische kwartaalverdeling (geen kwartaalvelden bestaan hier
 * uberhaupt), boeking-naar-regel-koppeling, gepland/correctief-afleiding,
 * overschrijdingswaarschuwing, VASTSTELLEN-/lifecyclelogica, Estimated.
 */

export type BgCorrectiefDagelijksControleErnst = BgControleErnst;

export interface BgCorrectiefDagelijksControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgCorrectiefDagelijksControleErnst;
  bericht: string;
}

export interface BgCorrectiefDagelijksRegelInvoer {
  omschrijving: string;
  /** `null` = NTB (nader te bepalen) — structureel geldig, geen control (OB028-003). */
  complexnummer: string | null;
  /** `null` = nog niet ingevoerd (OB028-004) — GEEN default naar 0, zie moduledoc. */
  jaarbedrag: Decimal | null;
}

export interface BgCorrectiefDagelijksAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
}

export type BgCorrectiefDagelijksReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgCorrectiefDagelijksRegelUitkomst {
  index: number;
  /** De oorspronkelijke invoer — traceerbaarheid. Kan een `null`/NaN-Decimal jaarbedrag bevatten; zie `jaarbedrag` hieronder voor de veilige berekende waarde. */
  invoer: BgCorrectiefDagelijksRegelInvoer;
  /** Veilige berekende bijdrage: `null`/NaN is hier al naar 0 herleid, een negatief bedrag blijft ongewijzigd. */
  jaarbedrag: Decimal;
}

export interface BgCorrectiefDagelijksResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van `aannames.beoordeeld` — nooit hier afgeleid. */
  beoordeeld: boolean;
  /** Afgeleide presentatietoestand (OB028-006). */
  reviewStatus: BgCorrectiefDagelijksReviewStatus;
  regels: BgCorrectiefDagelijksRegelUitkomst[];
  totaalJaar: Decimal;
  controleVereist: BgCorrectiefDagelijksControleItem[];
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

/** Herleidt een ontbrekend (`null`) of rekenkundig ongeldig (NaN) jaarbedrag naar een veilige 0-bijdrage; een negatief bedrag blijft ongewijzigd (moduledoc). */
function veiligJaarbedrag(waarde: Decimal | null): Decimal {
  if (waarde === null || isOngeldigDecimal(waarde)) return new Decimal(0);
  return waarde;
}

function valideerRegel(invoer: BgCorrectiefDagelijksRegelInvoer, index: number): BgCorrectiefDagelijksControleItem[] {
  const controleVereist: BgCorrectiefDagelijksControleItem[] = [];
  const meld = (bericht: string, ernst: BgCorrectiefDagelijksControleErnst = "KRITIEK") =>
    controleVereist.push({ regelIndex: index, ernst, bericht });

  if (leeg(invoer.omschrijving)) {
    meld(`Regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }
  // complexnummer === null (NTB) is structureel geldig — bewust GEEN control (OB028-003).

  if (invoer.jaarbedrag === null) {
    meld(`Regel ${index}: jaarbedrag ontbreekt — verplicht voor vaststellen; veilige bijdrage 0 toegepast.`);
  } else if (isOngeldigDecimal(invoer.jaarbedrag)) {
    meld(`Regel ${index}: jaarbedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.jaarbedrag.isNegative()) {
    meld(`Regel ${index}: jaarbedrag is negatief (${invoer.jaarbedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }

  return controleVereist;
}

function berekenRegel(
  invoer: BgCorrectiefDagelijksRegelInvoer,
  index: number,
): { uitkomst: BgCorrectiefDagelijksRegelUitkomst; controleVereist: BgCorrectiefDagelijksControleItem[] } {
  const controleVereist = valideerRegel(invoer, index);
  const jaarbedrag = veiligJaarbedrag(invoer.jaarbedrag);
  return { uitkomst: { index, invoer, jaarbedrag }, controleVereist };
}

export function berekenBegroteCorrectiefDagelijksOnderhoud(
  regelsInvoer: readonly BgCorrectiefDagelijksRegelInvoer[],
  aannames: BgCorrectiefDagelijksAannames,
): BgCorrectiefDagelijksResultaat {
  const controleVereist: BgCorrectiefDagelijksControleItem[] = [];
  const regels: BgCorrectiefDagelijksRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenRegel(invoer, index);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const totaalJaar = som(regels.map((r) => r.jaarbedrag));

  const reviewStatus: BgCorrectiefDagelijksReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_RULES"
      : "REVIEWED_WITH_RULES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    regels,
    totaalJaar,
    controleVereist,
  };
}
