import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * DELTA BUILD 2 (2026-09-24, FO/UX-conformering): Estimated Correctief/
 * Dagelijks Onderhoud — UITSLUITEND de pure rekenlaag, bovenop de reeds
 * geaccepteerde Delta Build 1 (`begroteCorrectiefDagelijksOnderhoud.ts`).
 * Conform OB-028/OB-030 en de vastgestelde UX (hfd. 8/11).
 *
 * BEWUST GEEN KLOON VAN GEPLAND-ONDERHOUD-ESTIMATED
 * (`begroteGeplandOnderhoudEstimated.ts`): Correctief/Dagelijks kent GEEN
 * kwartalen — één resterend bedrag per regel (OB-028), dus GEEN
 * `resterendeKwartalen`-aannamefilter zoals bij Gepland Onderhoud. Waar
 * hetzelfde principe wél van toepassing is (Werkelijk blijft moduleniveau,
 * nooit over regels verdeeld; functioneel incompleet ≠ financieel
 * onberekenbaar; Estimated overschrijft Begroting nooit) wordt dat principe
 * hergebruikt, niet de datastructuur.
 *
 * RESTEREND BEDRAG: `Decimal | null` — zelfde eersteklas-`null`-concept als
 * `BgCorrectiefDagelijksRegelInvoer.jaarbedrag`
 * (`begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc): `null` = "nog niet
 * ingevuld", GEEN NaN-workaround. Expliciet `Decimal(0)` is een andere,
 * eveneens geldige toestand ("geen aanvullende kosten meer verwacht") — de
 * uitkomst bewaart `invoer.resterendBedrag` ongewijzigd zodat een aanroeper
 * beide gevallen kan onderscheiden.
 *
 * RESTEREND BEDRAG VERPLICHT VOOR ESTIMATED-ONLY (§11, ANDERS DAN EEN
 * BESTAANDE REGEL): een bestaande regel zonder resterende verwachting is een
 * normale, informatieve CONCEPT-toestand (geen control) — er bestaat al een
 * oorspronkelijk Begroting-jaarbedrag. Een Estimated-only regel bestaat
 * uitsluitend VANWEGE een verwacht bedrag; `resterendBedrag === null` is daar
 * dus wél een KRITIEK-control (bedrag blijft, zoals overal in deze
 * modulefamilie, een veilige 0-bijdrage — nooit de regel laten verdwijnen).
 *
 * ESTIMATED-ONLY REGELS (6B): minimale velden
 * (omschrijving/complexnummer/grootboekrekening/ogbKostensoort/
 * resterendBedrag) — bewust GEEN status/kwartalen/maanden/bron-aanleiding/
 * leverancier/offerte/notitie (expliciet uitgesloten, §6B).
 *
 * BUITEN SCOPE (Delta Build 2): zie `begroteGeplandOnderhoudEstimated.ts`'s
 * moduledoc — identieke grens.
 */

export type BgCorrectiefDagelijksEstimatedControleErnst = BgControleErnst;

export interface BgCorrectiefDagelijksEstimatedControleItem {
  /** Positie binnen `resterendeVerwachtingen` (`bron: "BESTAANDE_REGEL"`) resp. `estimatedOnlyRegels` (`bron: "ESTIMATED_ONLY"`) van deze aanroep. `null` = module-breed. */
  itemIndex: number | null;
  bron: "BESTAANDE_REGEL" | "ESTIMATED_ONLY" | null;
  ernst: BgCorrectiefDagelijksEstimatedControleErnst;
  bericht: string;
}

/** `regelIndex`: positionele correlatie met de bestaande Begroting-regellijst van deze begrotingsversie — GEEN persistence-ID (zie moduledoc). */
export interface BgCorrectiefDagelijksResterendeVerwachtingInvoer {
  regelIndex: number;
  /** `null` = nog niet ingevuld — structureel geldig, GEEN control. Expliciet `Decimal(0)` telt mee en betekent "geen aanvullende kosten meer verwacht". */
  resterendBedrag: Decimal | null;
}

export interface BgCorrectiefDagelijksEstimatedOnlyRegelInvoer {
  omschrijving: string;
  /** `null` = NTB (nader te bepalen) — structureel geldig, geen control (zelfde als de Begroting-regel). */
  complexnummer: string | null;
  grootboekrekening: string;
  ogbKostensoort?: string | null;
  resterendBedrag: Decimal | null;
}

export interface BgCorrectiefDagelijksEstimatedAannames {
  begrotingsjaar: number;
  /** Bronfeit — reeds bepaald door de Werkelijk-Onderhoud-laag of een latere orchestratie. Deze calculator herleidt dit bedrag NOOIT zelf uit boekingen. */
  werkelijkTotaalTotAfgeslotenPeriode: Decimal;
}

export interface BgCorrectiefDagelijksResterendeVerwachtingUitkomst {
  regelIndex: number;
  invoer: BgCorrectiefDagelijksResterendeVerwachtingInvoer;
  /** Veilige, meetellende bijdrage: `null`/NaN is hier al naar 0 herleid, een negatief bedrag blijft ongewijzigd. */
  bedrag: Decimal;
}

export interface BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst {
  index: number;
  invoer: BgCorrectiefDagelijksEstimatedOnlyRegelInvoer;
  bedrag: Decimal;
}

export interface BgCorrectiefDagelijksEstimatedResultaat {
  begrotingsjaar: number;
  werkelijkTotaalTotAfgeslotenPeriode: Decimal;
  resterendeVerwachtingen: readonly BgCorrectiefDagelijksResterendeVerwachtingUitkomst[];
  estimatedOnlyRegels: readonly BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst[];
  somResterendBestaandeRegels: Decimal;
  somResterendEstimatedOnly: Decimal;
  /** = werkelijkTotaalTotAfgeslotenPeriode + somResterendBestaandeRegels + somResterendEstimatedOnly. NOOIT + Begroting. */
  estimatedTotaal: Decimal;
  controleVereist: readonly BgCorrectiefDagelijksEstimatedControleItem[];
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

function berekenResterendeVerwachting(
  invoer: BgCorrectiefDagelijksResterendeVerwachtingInvoer,
  index: number,
): { uitkomst: BgCorrectiefDagelijksResterendeVerwachtingUitkomst; controleVereist: BgCorrectiefDagelijksEstimatedControleItem[] } {
  const controleVereist: BgCorrectiefDagelijksEstimatedControleItem[] = [];
  const meld = (bericht: string, ernst: BgCorrectiefDagelijksEstimatedControleErnst = "KRITIEK") =>
    controleVereist.push({ itemIndex: index, bron: "BESTAANDE_REGEL", ernst, bericht });
  const context = `Resterende verwachting regel ${invoer.regelIndex}`;

  let bedrag: Decimal;
  if (invoer.resterendBedrag === null) {
    bedrag = new Decimal(0);
  } else if (isOngeldigDecimal(invoer.resterendBedrag)) {
    meld(`${context}: resterend bedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
    bedrag = new Decimal(0);
  } else {
    if (invoer.resterendBedrag.isNegative()) {
      meld(`${context}: resterend bedrag is negatief (${invoer.resterendBedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
    bedrag = invoer.resterendBedrag;
  }

  return { uitkomst: { regelIndex: invoer.regelIndex, invoer, bedrag }, controleVereist };
}

function berekenEstimatedOnlyRegel(
  invoer: BgCorrectiefDagelijksEstimatedOnlyRegelInvoer,
  index: number,
): { uitkomst: BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst; controleVereist: BgCorrectiefDagelijksEstimatedControleItem[] } {
  const controleVereist: BgCorrectiefDagelijksEstimatedControleItem[] = [];
  const meld = (bericht: string, ernst: BgCorrectiefDagelijksEstimatedControleErnst = "KRITIEK") =>
    controleVereist.push({ itemIndex: index, bron: "ESTIMATED_ONLY", ernst, bericht });
  const context = `Estimated-only regel ${index}`;

  if (leeg(invoer.omschrijving)) {
    meld(`${context}: omschrijving ontbreekt — verplicht voor een complete Estimated-only regel; bedrag blijft financieel meetellen.`);
  }
  if (leeg(invoer.grootboekrekening)) {
    meld(`${context}: grootboekrekening ontbreekt — verplicht voor een complete Estimated-only regel; bedrag blijft financieel meetellen.`);
  }
  // complexnummer === null (NTB) is structureel geldig — bewust GEEN control (zelfde als de Begroting-regel).

  let bedrag: Decimal;
  if (invoer.resterendBedrag === null) {
    meld(`${context}: resterend bedrag ontbreekt — verplicht voor een complete Estimated-only regel; veilige bijdrage 0 toegepast.`);
    bedrag = new Decimal(0);
  } else if (isOngeldigDecimal(invoer.resterendBedrag)) {
    meld(`${context}: resterend bedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
    bedrag = new Decimal(0);
  } else {
    if (invoer.resterendBedrag.isNegative()) {
      meld(`${context}: resterend bedrag is negatief (${invoer.resterendBedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
    bedrag = invoer.resterendBedrag;
  }

  return { uitkomst: { index, invoer, bedrag }, controleVereist };
}

/**
 * DELTA BUILD 3 (2026-09-24, Onderhoud-brede orchestratie): resultaat van
 * UITSLUITEND de resterende-verwachtingscomponent — bewust geen aparte
 * aannames-parameter nodig (anders dan Gepland Onderhoud: Correctief/
 * Dagelijks kent geen kwartalen, dus geen `resterendeKwartalen`-invoer, zie
 * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc "BEWUST GEEN KLOON").
 */
export interface BgCorrectiefDagelijksResterendeVerwachtingResultaat {
  resterendeVerwachtingen: readonly BgCorrectiefDagelijksResterendeVerwachtingUitkomst[];
  estimatedOnlyRegels: readonly BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst[];
  somResterendBestaandeRegels: Decimal;
  somResterendEstimatedOnly: Decimal;
  /** = somResterendBestaandeRegels + somResterendEstimatedOnly. GEEN Werkelijk hierin — deze functie kent structureel geen Werkelijk-parameter (zie moduledoc). */
  totaal: Decimal;
  controleVereist: readonly BgCorrectiefDagelijksEstimatedControleItem[];
}

/**
 * DELTA BUILD 3 (2026-09-24, Onderhoud-brede orchestratie): de resterende-
 * verwachtingsberekening van `berekenEstimatedCorrectiefDagelijksOnderhoud`,
 * UITGELICHT als eigen, herbruikbare functie — bewust ZONDER Werkelijk-
 * parameter, zie `berekenResterendeVerwachtingGeplandOnderhoud`'s moduledoc
 * (`begroteGeplandOnderhoudEstimated.ts`) voor de volledige onderbouwing
 * (Werkelijk Onderhoud kan niet naar Gepland/Correctief worden gesplitst —
 * een "Werkelijk Correctief/Dagelijks" bestaat domeinkundig niet). De
 * Onderhoud-brede orchestratielaag telt Werkelijk exact ÉÉNMAAL op
 * Onderhoud-totaalniveau op, NA deze functie, nooit hier.
 *
 * `berekenEstimatedCorrectiefDagelijksOnderhoud` hieronder blijft 100%
 * backward compatible — deze functie is puur een interne extractie.
 */
export function berekenResterendeVerwachtingCorrectiefDagelijksOnderhoud(
  resterendeVerwachtingenInvoer: readonly BgCorrectiefDagelijksResterendeVerwachtingInvoer[],
  estimatedOnlyRegelsInvoer: readonly BgCorrectiefDagelijksEstimatedOnlyRegelInvoer[],
): BgCorrectiefDagelijksResterendeVerwachtingResultaat {
  const controleVereist: BgCorrectiefDagelijksEstimatedControleItem[] = [];

  const resterendeVerwachtingen: BgCorrectiefDagelijksResterendeVerwachtingUitkomst[] = resterendeVerwachtingenInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenResterendeVerwachting(invoer, index);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const estimatedOnlyRegels: BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst[] = estimatedOnlyRegelsInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenEstimatedOnlyRegel(invoer, index);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const somResterendBestaandeRegels = som(resterendeVerwachtingen.map((r) => r.bedrag));
  const somResterendEstimatedOnly = som(estimatedOnlyRegels.map((r) => r.bedrag));

  return {
    resterendeVerwachtingen,
    estimatedOnlyRegels,
    somResterendBestaandeRegels,
    somResterendEstimatedOnly,
    totaal: som([somResterendBestaandeRegels, somResterendEstimatedOnly]),
    controleVereist,
  };
}

export function berekenEstimatedCorrectiefDagelijksOnderhoud(
  resterendeVerwachtingenInvoer: readonly BgCorrectiefDagelijksResterendeVerwachtingInvoer[],
  estimatedOnlyRegelsInvoer: readonly BgCorrectiefDagelijksEstimatedOnlyRegelInvoer[],
  aannames: BgCorrectiefDagelijksEstimatedAannames,
): BgCorrectiefDagelijksEstimatedResultaat {
  const resterend = berekenResterendeVerwachtingCorrectiefDagelijksOnderhoud(resterendeVerwachtingenInvoer, estimatedOnlyRegelsInvoer);

  const werkelijkTotaalTotAfgeslotenPeriode = veiligBedrag(aannames.werkelijkTotaalTotAfgeslotenPeriode);
  const estimatedTotaal = som([werkelijkTotaalTotAfgeslotenPeriode, resterend.somResterendBestaandeRegels, resterend.somResterendEstimatedOnly]);

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    werkelijkTotaalTotAfgeslotenPeriode,
    resterendeVerwachtingen: resterend.resterendeVerwachtingen,
    estimatedOnlyRegels: resterend.estimatedOnlyRegels,
    somResterendBestaandeRegels: resterend.somResterendBestaandeRegels,
    somResterendEstimatedOnly: resterend.somResterendEstimatedOnly,
    estimatedTotaal,
    controleVereist: resterend.controleVereist,
  };
}
