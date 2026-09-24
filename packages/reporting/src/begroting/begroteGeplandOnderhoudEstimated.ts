import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * DELTA BUILD 2 (2026-09-24, FO/UX-conformering): Estimated Gepland
 * Onderhoud — UITSLUITEND de pure rekenlaag, bovenop de reeds geaccepteerde
 * Delta Build 1 (`begroteGeplandOnderhoud.ts`). Conform OB-027/OB-030
 * (`FO_Exploitatiebegroting_v1.0.md`) en de vastgestelde UX (hfd. 7/11).
 *
 * DRIE PERSPECTIEVEN, STRIKT GESCHEIDEN: Begroting (`begroteGeplandOnderhoud.ts`,
 * ongewijzigd), Werkelijk (`werkelijkOnderhoud.ts`, ongewijzigd, GEEN
 * dubbele rekenlogica hier) en Estimated (dit bestand). Estimated overschrijft
 * de oorspronkelijke Begroting NOOIT — deze module ontvangt zelfs geen
 * Begroting-Q1-Q4-bedragen als invoer, uitsluitend een reeds bepaald
 * `werkelijkTotaalTotAfgeslotenPeriode` (bronfeit, hier NIET zelf herleid uit
 * boekingen — dat blijft de taak van `werkelijkOnderhoud.ts`/een toekomstige
 * orchestratielaag, buiten scope van deze delta) plus handmatig vastgelegde
 * resterende verwachtingen.
 *
 * WERKELIJK OP MODULENIVEAU, NOOIT PER ACTIVITEIT: de financiële bron bevat
 * geen betrouwbare koppeling tussen een boeking en een individuele
 * begrotingsactiviteit (zie FASE GAT-008B/`werkelijkOnderhoud.ts`'s
 * moduledoc). Deze calculator verdeelt Werkelijk daarom NOOIT over
 * activiteiten — `werkelijkTotaalTotAfgeslotenPeriode` is één enkel
 * modulebreed bedrag, rechtstreeks in `estimatedTotaal` verwerkt.
 *
 * RESTERENDE VERWACHTING PER BESTAANDE ACTIVITEIT (5A): een aparte,
 * kwartaalgedreven structuur naast de oorspronkelijke activiteit —
 * `activiteitIndex` is, net als overal elders in deze module-familie,
 * uitsluitend een positionele correlatiesleutel binnen ÉÉN aanroep (geen
 * persistence-ID; die vertaling gebeurt bij `@bvc/begroting-data`, exact
 * dezelfde architectuurgrens als `begroteGeplandOnderhoud.ts`). `q1`-`q4`
 * zijn bewust `Decimal` (NIET `| null`) — zelfde invoervorm als de
 * oorspronkelijke Begroting-activiteit (geen nieuwe leeg/0-onderscheiding
 * geïntroduceerd waar het bestaande Gepland-model die ook niet kent).
 *
 * AFGESLOTEN VERSUS RESTERENDE PERIODE (5B): GEEN nieuwe centrale
 * periode-afsluitingsarchitectuur. `aannames.resterendeKwartalen` is
 * expliciete invoer van de aanroeper (welke kwartalen nog NIET zijn
 * afgesloten). Een resterende-verwachtingbedrag voor een kwartaal BUITEN die
 * set telt NIET mee in `estimatedTotaal` (zou anders Werkelijk dubbel tellen,
 * want Werkelijk dekt per definitie de afgesloten periode al af) en levert
 * een WAARSCHUWING op — géén KRITIEK, want het bedrag wordt bewust genegeerd,
 * niet foutief verwerkt.
 *
 * ESTIMATED-ONLY ACTIVITEITEN (5C): een minimale, losstaande activiteitvorm
 * (complexnummer/omschrijving/grootboekrekening/ogbKostensoort/q1-q4) die
 * NOOIT de oorspronkelijke Begroting wijzigt en GEEN automatische
 * terugschrijving kent. Bewust GEEN status/aanleiding/leverancier/
 * offertebedrag/notitie (zelfde terughoudendheid als Correctief/Dagelijks'
 * Estimated-only-regels, zie dat bestand) — minimaal financieel en
 * inhoudelijk herleidbaar (§11) is voldoende, geen kloon van het volledige
 * Begroting-activiteitmodel.
 *
 * STATUS BEÏNVLOEDT NIETS (5D): deze module kent `status` op een bestaande
 * activiteit niet eens als invoer — er is dus structureel geen manier waarop
 * AFGEROND/VERVALLEN/UITGESTELD de optelling zou kunnen raken.
 *
 * FUNCTIONEEL INCOMPLEET ≠ FINANCIEEL ONBEREKENBAAR (zelfde principe als
 * `begroteGeplandOnderhoud.ts`): een ontbrekend verplicht veld op een
 * Estimated-only activiteit levert een KRITIEK-control op, maar de bedragen
 * blijven meetellen. Een NaN-Decimal krijgt een veilige 0-bijdrage; een
 * negatief bedrag is geldig (WAARSCHUWING, telt volledig mee) — exact
 * dezelfde regels als Delta Build 1.
 *
 * BUITEN SCOPE (Delta Build 2, expliciet niet gebouwd — geen aanname): UI,
 * renderer, Worker/CLI/API, volledige Werkelijk/Begroting/Estimated-
 * orchestratie (dus GEEN aanroep vanuit `herberekenen.ts`/`vaststellen.ts`),
 * automatische periode-afsluiting, automatische boeking-naar-activiteit-
 * matching, reviewStatus/vaststellen-koppeling voor Estimated (niet reeds
 * vastgesteld — zie oplevering).
 */

export type BgOnderhoudKwartaal = "Q1" | "Q2" | "Q3" | "Q4";

const ALLE_KWARTALEN: readonly BgOnderhoudKwartaal[] = ["Q1", "Q2", "Q3", "Q4"];

export type BgGeplandOnderhoudEstimatedControleErnst = BgControleErnst;

export interface BgGeplandOnderhoudEstimatedControleItem {
  /** Positie binnen `resterendeVerwachtingen` (`bron: "BESTAANDE_ACTIVITEIT"`) resp. `estimatedOnlyActiviteiten` (`bron: "ESTIMATED_ONLY"`) van deze aanroep. `null` = module-breed. */
  itemIndex: number | null;
  bron: "BESTAANDE_ACTIVITEIT" | "ESTIMATED_ONLY" | null;
  ernst: BgGeplandOnderhoudEstimatedControleErnst;
  bericht: string;
}

/** `activiteitIndex`: positionele correlatie met de bestaande Begroting-activiteitenlijst van deze begrotingsversie — GEEN persistence-ID (zie moduledoc). */
export interface BgGeplandOnderhoudResterendeVerwachtingInvoer {
  activiteitIndex: number;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

export interface BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer {
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogbKostensoort?: string | null;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

export interface BgGeplandOnderhoudEstimatedAannames {
  begrotingsjaar: number;
  /** Bronfeit — reeds bepaald door de Werkelijk-Onderhoud-laag (`werkelijkOnderhoud.ts`) of een latere orchestratie. Deze calculator herleidt dit bedrag NOOIT zelf uit boekingen. */
  werkelijkTotaalTotAfgeslotenPeriode: Decimal;
  /** Expliciete invoer — welke kwartalen nog NIET zijn afgesloten (zie moduledoc §5B). */
  resterendeKwartalen: readonly BgOnderhoudKwartaal[];
}

export interface BgGeplandOnderhoudResterendeVerwachtingUitkomst {
  activiteitIndex: number;
  invoer: BgGeplandOnderhoudResterendeVerwachtingInvoer;
  /** Veilige, meetellende bijdrage per kwartaal — 0 voor een niet-resterend kwartaal of een ongeldig (NaN) bedrag. */
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  totaal: Decimal;
}

export interface BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst {
  index: number;
  invoer: BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  totaal: Decimal;
}

export interface BgGeplandOnderhoudEstimatedResultaat {
  begrotingsjaar: number;
  werkelijkTotaalTotAfgeslotenPeriode: Decimal;
  resterendeVerwachtingen: readonly BgGeplandOnderhoudResterendeVerwachtingUitkomst[];
  estimatedOnlyActiviteiten: readonly BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst[];
  somResterendBestaandeActiviteiten: Decimal;
  somResterendEstimatedOnly: Decimal;
  /** = werkelijkTotaalTotAfgeslotenPeriode + somResterendBestaandeActiviteiten + somResterendEstimatedOnly. NOOIT + Begroting. */
  estimatedTotaal: Decimal;
  controleVereist: readonly BgGeplandOnderhoudEstimatedControleItem[];
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

function veiligBedrag(waarde: Decimal): Decimal {
  return isOngeldigDecimal(waarde) ? new Decimal(0) : waarde;
}

/**
 * Verwerkt één kwartaalbedrag tot een veilige bijdrage + eventuele controls.
 * Een kwartaal buiten `resterendeKwartalen` telt NOOIT mee (voorkomt
 * dubbeltelling met Werkelijk) — een niet-nul bedrag daar is een
 * WAARSCHUWING, geen KRITIEK (het bedrag wordt bewust genegeerd, niet
 * foutief verwerkt).
 */
function veiligeKwartaalBijdrage(
  kwartaal: BgOnderhoudKwartaal,
  waarde: Decimal,
  resterendeKwartalen: ReadonlySet<BgOnderhoudKwartaal>,
  meld: (bericht: string, ernst: BgGeplandOnderhoudEstimatedControleErnst) => void,
  context: string,
): Decimal {
  if (isOngeldigDecimal(waarde)) {
    meld(`${context}: ${kwartaal} is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`, "KRITIEK");
    return new Decimal(0);
  }
  if (!resterendeKwartalen.has(kwartaal)) {
    if (!waarde.isZero()) {
      meld(
        `${context}: ${kwartaal} is geen resterend kwartaal (al afgesloten) — bedrag (${waarde.toString()}) telt NIET mee in Estimated, voorkomt dubbeltelling met Werkelijk.`,
        "WAARSCHUWING",
      );
    }
    return new Decimal(0);
  }
  if (waarde.isNegative()) {
    meld(`${context}: ${kwartaal} is negatief (${waarde.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }
  return waarde;
}

function berekenResterendeVerwachting(
  invoer: BgGeplandOnderhoudResterendeVerwachtingInvoer,
  index: number,
  resterendeKwartalen: ReadonlySet<BgOnderhoudKwartaal>,
): { uitkomst: BgGeplandOnderhoudResterendeVerwachtingUitkomst; controleVereist: BgGeplandOnderhoudEstimatedControleItem[] } {
  const controleVereist: BgGeplandOnderhoudEstimatedControleItem[] = [];
  const meld = (bericht: string, ernst: BgGeplandOnderhoudEstimatedControleErnst) =>
    controleVereist.push({ itemIndex: index, bron: "BESTAANDE_ACTIVITEIT", ernst, bericht });
  const context = `Resterende verwachting activiteit ${invoer.activiteitIndex}`;

  const q1 = veiligeKwartaalBijdrage("Q1", invoer.q1, resterendeKwartalen, meld, context);
  const q2 = veiligeKwartaalBijdrage("Q2", invoer.q2, resterendeKwartalen, meld, context);
  const q3 = veiligeKwartaalBijdrage("Q3", invoer.q3, resterendeKwartalen, meld, context);
  const q4 = veiligeKwartaalBijdrage("Q4", invoer.q4, resterendeKwartalen, meld, context);

  return {
    uitkomst: { activiteitIndex: invoer.activiteitIndex, invoer, q1, q2, q3, q4, totaal: som([q1, q2, q3, q4]) },
    controleVereist,
  };
}

function berekenEstimatedOnlyActiviteit(
  invoer: BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer,
  index: number,
  resterendeKwartalen: ReadonlySet<BgOnderhoudKwartaal>,
): { uitkomst: BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst; controleVereist: BgGeplandOnderhoudEstimatedControleItem[] } {
  const controleVereist: BgGeplandOnderhoudEstimatedControleItem[] = [];
  const meld = (bericht: string, ernst: BgGeplandOnderhoudEstimatedControleErnst) =>
    controleVereist.push({ itemIndex: index, bron: "ESTIMATED_ONLY", ernst, bericht });
  const context = `Estimated-only activiteit ${index}`;

  if (leeg(invoer.complexnummer)) {
    meld(`${context}: complexnummer ontbreekt — verplicht voor een complete Estimated-only activiteit; bedrag blijft financieel meetellen.`, "KRITIEK");
  }
  if (leeg(invoer.omschrijving)) {
    meld(`${context}: omschrijving ontbreekt — verplicht voor een complete Estimated-only activiteit; bedrag blijft financieel meetellen.`, "KRITIEK");
  }
  if (leeg(invoer.grootboekrekening)) {
    meld(`${context}: grootboekrekening ontbreekt — verplicht voor een complete Estimated-only activiteit; bedrag blijft financieel meetellen.`, "KRITIEK");
  }

  const q1 = veiligeKwartaalBijdrage("Q1", invoer.q1, resterendeKwartalen, meld, context);
  const q2 = veiligeKwartaalBijdrage("Q2", invoer.q2, resterendeKwartalen, meld, context);
  const q3 = veiligeKwartaalBijdrage("Q3", invoer.q3, resterendeKwartalen, meld, context);
  const q4 = veiligeKwartaalBijdrage("Q4", invoer.q4, resterendeKwartalen, meld, context);

  return { uitkomst: { index, invoer, q1, q2, q3, q4, totaal: som([q1, q2, q3, q4]) }, controleVereist };
}

/**
 * DELTA BUILD 3 (2026-09-24, Onderhoud-brede orchestratie): aannames voor
 * UITSLUITEND de resterende-verwachtingscomponent — bewust GEEN
 * `werkelijkTotaalTotAfgeslotenPeriode`/`begrotingsjaar` (die horen bij het
 * VOLLEDIGE Estimated-perspectief, niet bij de resterende verwachting op
 * zich). Zie `berekenResterendeVerwachtingGeplandOnderhoud`'s moduledoc.
 */
export interface BgGeplandOnderhoudResterendeVerwachtingAannames {
  resterendeKwartalen: readonly BgOnderhoudKwartaal[];
}

export interface BgGeplandOnderhoudResterendeVerwachtingResultaat {
  resterendeVerwachtingen: readonly BgGeplandOnderhoudResterendeVerwachtingUitkomst[];
  estimatedOnlyActiviteiten: readonly BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst[];
  somResterendBestaandeActiviteiten: Decimal;
  somResterendEstimatedOnly: Decimal;
  /** = somResterendBestaandeActiviteiten + somResterendEstimatedOnly. GEEN Werkelijk hierin — deze functie kent structureel geen Werkelijk-parameter (zie moduledoc). */
  totaal: Decimal;
  controleVereist: readonly BgGeplandOnderhoudEstimatedControleItem[];
}

/**
 * DELTA BUILD 3 (2026-09-24, Onderhoud-brede orchestratie): de resterende-
 * verwachtingsberekening van `berekenEstimatedGeplandOnderhoud`, UITGELICHT
 * als eigen, herbruikbare functie — bewust ZONDER Werkelijk-parameter, dus
 * structureel onmogelijk om hier per ongeluk een "Estimated Gepland"-
 * pseudototaal (Werkelijk + resterend) te construeren. Reden (vastgesteld
 * business-/architectuurcontract na Delta Build 3's Gate 9): Werkelijk
 * Onderhoud kan NIET betrouwbaar naar Gepland versus Correctief/Dagelijks
 * worden gesplitst (zie `werkelijkOnderhoud.ts`'s moduledoc) — een
 * "Werkelijk Gepland" bestaat domeinkundig niet. De Onderhoud-brede
 * orchestratielaag (`@bvc/begroting-data`'s `onderhoudOrchestratie.ts`) telt
 * Werkelijk daarom exact ÉÉNMAAL op Onderhoud-totaalniveau op, NA deze
 * functie, nooit hier.
 *
 * `berekenEstimatedGeplandOnderhoud` hieronder blijft 100% backward
 * compatible: exact dezelfde signatuur/output/gedrag als vóór Delta Build 3
 * — deze functie is puur een interne extractie, geen nieuwe rekenregel.
 */
export function berekenResterendeVerwachtingGeplandOnderhoud(
  resterendeVerwachtingenInvoer: readonly BgGeplandOnderhoudResterendeVerwachtingInvoer[],
  estimatedOnlyActiviteitenInvoer: readonly BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer[],
  aannames: BgGeplandOnderhoudResterendeVerwachtingAannames,
): BgGeplandOnderhoudResterendeVerwachtingResultaat {
  const resterendeKwartalen = new Set<BgOnderhoudKwartaal>(
    aannames.resterendeKwartalen.filter((k) => ALLE_KWARTALEN.includes(k)),
  );

  const controleVereist: BgGeplandOnderhoudEstimatedControleItem[] = [];

  const resterendeVerwachtingen: BgGeplandOnderhoudResterendeVerwachtingUitkomst[] = resterendeVerwachtingenInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenResterendeVerwachting(invoer, index, resterendeKwartalen);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const estimatedOnlyActiviteiten: BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst[] = estimatedOnlyActiviteitenInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenEstimatedOnlyActiviteit(invoer, index, resterendeKwartalen);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const somResterendBestaandeActiviteiten = som(resterendeVerwachtingen.map((r) => r.totaal));
  const somResterendEstimatedOnly = som(estimatedOnlyActiviteiten.map((a) => a.totaal));

  return {
    resterendeVerwachtingen,
    estimatedOnlyActiviteiten,
    somResterendBestaandeActiviteiten,
    somResterendEstimatedOnly,
    totaal: som([somResterendBestaandeActiviteiten, somResterendEstimatedOnly]),
    controleVereist,
  };
}

export function berekenEstimatedGeplandOnderhoud(
  resterendeVerwachtingenInvoer: readonly BgGeplandOnderhoudResterendeVerwachtingInvoer[],
  estimatedOnlyActiviteitenInvoer: readonly BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer[],
  aannames: BgGeplandOnderhoudEstimatedAannames,
): BgGeplandOnderhoudEstimatedResultaat {
  const resterend = berekenResterendeVerwachtingGeplandOnderhoud(resterendeVerwachtingenInvoer, estimatedOnlyActiviteitenInvoer, {
    resterendeKwartalen: aannames.resterendeKwartalen,
  });

  const werkelijkTotaalTotAfgeslotenPeriode = veiligBedrag(aannames.werkelijkTotaalTotAfgeslotenPeriode);
  const estimatedTotaal = som([werkelijkTotaalTotAfgeslotenPeriode, resterend.somResterendBestaandeActiviteiten, resterend.somResterendEstimatedOnly]);

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    werkelijkTotaalTotAfgeslotenPeriode,
    resterendeVerwachtingen: resterend.resterendeVerwachtingen,
    estimatedOnlyActiviteiten: resterend.estimatedOnlyActiviteiten,
    somResterendBestaandeActiviteiten: resterend.somResterendBestaandeActiviteiten,
    somResterendEstimatedOnly: resterend.somResterendEstimatedOnly,
    estimatedTotaal,
    controleVereist: resterend.controleVereist,
  };
}
