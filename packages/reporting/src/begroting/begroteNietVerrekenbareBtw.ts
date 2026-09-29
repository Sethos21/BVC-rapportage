import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Niet verrekenbare BTW — Vervolgtranche 9 Deel B (Master Contract): een
 * zelfstandige P&L-post, BOVEN EBITDA, GEEN automatische pro-rata-berekening.
 *
 * GEEN CATEGORIEËN (zelfde patroon als Correctief/Dagelijks Onderhoud/Geplande
 * Verkoop): "Niet verrekenbare BTW" is één homogene regelsoort — één
 * module-brede `beoordeeld`-vlag, geen categoriedimensie (het Master Contract
 * kent er voor deze post geen).
 *
 * BEGROTINGSVOORSTEL O.B.V. WERKELIJK VORIG JAAR (Master Contract, expliciet
 * toegestaan): `vorigJaarWerkelijk` is een apart doorgegeven, PUUR INFORMATIEF
 * bedrag — het wijzigt NOOIT `moduleTotaal` (dat blijft uitsluitend de som van
 * de handmatige regels, exact het rekenhulp-precedent van
 * `begroteAlgemeneKosten.ts`'s `berekendVoorstel`). "Geen automatische
 * pro-rata" betekent hier concreet: GEEN percentage-/formuletransformatie op
 * het voorstel — het voorstel IS `vorigJaarWerkelijk`, ongewijzigd, nooit
 * doorgerekend (anders dan Algemene Kosten se optionele
 * vorigJaarBedrag×(1+%)-rekenhulp). Ontbrekende historische bron (`null`) is
 * zelf geen fout en blokkeert Begroting niet — de gebruiker vult dan gewoon
 * handmatig in (het bewuste €0-pad blijft via `beoordeeld=true`/0 regels
 * beschikbaar, zoals overal elders).
 *
 * VEILIGE 0-BIJDRAGE BIJ ONTBREKEND JAARBEDRAG (zelfde precedent als Algemene
 * Kosten/Leegstand, BEWUST ANDERS dan Geplande Verkoop): een ontbrekend/NaN
 * `jaarbedrag` op een regel triggert een KRITIEKE control maar telt financieel
 * veilig als 0 mee — "functioneel onvolledig ≠ financieel onberekenbaar".
 *
 * BUITEN SCOPE (deze fase, expliciet niet gebouwd): Werkelijk/Estimated/
 * P&L-rendering/UI/persistence (zie afzonderlijke modules/`@bvc/begroting-data`).
 */

export interface BgNietVerrekenbareBtwControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgControleErnst;
  bericht: string;
}

export interface BgNietVerrekenbareBtwRegelInvoer {
  omschrijving: string;
  /** `null` = administratiebreed, geen validatie/aggregatie op dit veld. */
  complexnummer: string | null;
  /** `null` = nog niet ingevoerd — GEEN default naar 0. */
  jaarbedrag: Decimal | null;
}

export interface BgNietVerrekenbareBtwAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
  /** Werkelijk vorig jaar — puur informatieve voorstelbron (Master Contract). `null` = geen betrouwbare historische bron, blokkeert Begroting niet. */
  vorigJaarWerkelijk: Decimal | null;
}

export type BgNietVerrekenbareBtwReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgNietVerrekenbareBtwRegelUitkomst {
  index: number;
  invoer: BgNietVerrekenbareBtwRegelInvoer;
  /** Veilige berekende bijdrage: een `null`/NaN jaarbedrag is al naar 0 herleid. */
  jaarbedrag: Decimal;
}

export interface BgNietVerrekenbareBtwResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van de aanname — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgNietVerrekenbareBtwReviewStatus;
  regels: BgNietVerrekenbareBtwRegelUitkomst[];
  moduleTotaal: Decimal;
  /** Pure doorgifte — traceerbaarheid, wijzigt nooit `moduleTotaal` (zie moduledoc). */
  vorigJaarWerkelijk: Decimal | null;
  controleVereist: BgNietVerrekenbareBtwControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

function leeg(waarde: string): boolean {
  return waarde.trim().length === 0;
}

function veiligJaarbedrag(waarde: Decimal | null): Decimal {
  return isGeldigDecimal(waarde) ? waarde : new Decimal(0);
}

function valideerRegel(invoer: BgNietVerrekenbareBtwRegelInvoer, index: number): BgNietVerrekenbareBtwControleItem[] {
  const controleVereist: BgNietVerrekenbareBtwControleItem[] = [];
  const meld = (bericht: string, ernst: BgControleErnst = "KRITIEK") => controleVereist.push({ regelIndex: index, ernst, bericht });

  if (leeg(invoer.omschrijving)) {
    meld(`Regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }
  if (invoer.jaarbedrag === null) {
    meld(`Regel ${index}: jaarbedrag ontbreekt — verplicht voor vaststellen; veilige bijdrage 0 toegepast.`);
  } else if (invoer.jaarbedrag.isNaN()) {
    meld(`Regel ${index}: jaarbedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.jaarbedrag.isNegative()) {
    meld(`Regel ${index}: jaarbedrag is negatief (${invoer.jaarbedrag.toString()}) — toegestaan (bv. een BTW-teruggave), telt volledig mee.`, "WAARSCHUWING");
  }

  return controleVereist;
}

export function berekenBegroteNietVerrekenbareBtw(regelsInvoer: readonly BgNietVerrekenbareBtwRegelInvoer[], aannames: BgNietVerrekenbareBtwAannames): BgNietVerrekenbareBtwResultaat {
  const controleVereist: BgNietVerrekenbareBtwControleItem[] = [];

  const regels: BgNietVerrekenbareBtwRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    controleVereist.push(...valideerRegel(invoer, index));
    return { index, invoer, jaarbedrag: veiligJaarbedrag(invoer.jaarbedrag) };
  });

  if (aannames.vorigJaarWerkelijk !== null) {
    if (aannames.vorigJaarWerkelijk.isNaN()) {
      controleVereist.push({ regelIndex: null, ernst: "KRITIEK", bericht: "vorigJaarWerkelijk is geen geldig getal (NaN) — voorstel niet beschikbaar." });
    } else if (aannames.vorigJaarWerkelijk.isNegative()) {
      controleVereist.push({ regelIndex: null, ernst: "WAARSCHUWING", bericht: `vorigJaarWerkelijk is negatief (${aannames.vorigJaarWerkelijk.toString()}) — toegestaan, rekenkundig verwerkt.` });
    }
  }

  const reviewStatus: BgNietVerrekenbareBtwReviewStatus = !aannames.beoordeeld ? "NOT_REVIEWED" : regels.length === 0 ? "REVIEWED_ZERO_RULES" : "REVIEWED_WITH_RULES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    regels,
    moduleTotaal: som(regels.map((r) => r.jaarbedrag)),
    vorigJaarWerkelijk: aannames.vorigJaarWerkelijk,
    controleVereist,
  };
}
