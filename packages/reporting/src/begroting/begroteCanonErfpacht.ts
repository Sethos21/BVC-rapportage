import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Canon erfpacht (OB-034; Master Contract §6.9; UX-contract §9.3) —
 * UITSLUITEND de pure rekenlaag. Architectuurgrens zoals de overige
 * begrotingsmodules: geen cache/SQLite/klok/IO/renderer; expliciete invoer per
 * regel + module-brede aannames → berekende uitkomst.
 *
 * REGELMODEL (vastgesteld, UX §9.3): één compacte regel per BESTAAND complex
 * met uitsluitend jaarcanon en indexatiepercentage (+ de verplichte
 * grootboekrekening en optionele OGB-kostensoort). Bewust GEEN omschrijving,
 * looptijd, ingangsdatum, frequentie of contractvelden.
 *
 * REKENREGEL (vastgesteld): begroot bedrag per complex =
 * `jaarcanon × (1 + indexering/100)` voor het VOLLEDIGE jaar (indexering in
 * hele procenten, zelfde conventie als Verzekeringen). Geen tijdsevenredigheid,
 * geen tussentijdse afronding in de rekenlaag.
 *
 * NULL VERSUS €0 (universele invariant): `jaarcanon === null` is "niet
 * ingevuld" (KRITIEK, blokkeert beoordeling, veilige €0-bijdrage). Een
 * EXPLICIETE jaarcanon van €0 betekent bewust geen erfpacht: geldig, indexering
 * is dan niet vereist (een aanwezige indexering wordt genegeerd, bedrag blijft
 * €0). Bij een jaarcanon ≠ 0 is een ontbrekende (`null`) indexering een
 * KRITIEK-control met veilige €0-bijdrage — nooit een geraden 0%.
 *
 * NEGATIEVE WAARDEN: zelfde generieke patroon als de overige modules — geldig,
 * telt volledig mee, WAARSCHUWING (niet-blokkerend).
 *
 * COMPLEX ALS SLEUTEL: `complexnummer` is de technische sleutel (nooit
 * omschrijving). Een leeg complexnummer of een tweede regel voor hetzelfde
 * complex is KRITIEK ("één regel per complex"); bedragen blijven meetellen.
 *
 * REVIEW: `beoordeeld` is pure doorgifte, nooit afgeleid. Geen regels + bewust
 * beoordeeld = bewust €0 (`REVIEWED_ZERO_RULES`).
 *
 * BUITEN SCOPE (bewust, geen aanname): verbergen van de module per administratie
 * (generieke administratie-brede registratie bestaat nog niet), integratie in
 * vaststellen/herberekenen/frozen, Werkelijk/Estimated (geen bewezen
 * GL-bronmapping voor erfpacht), handmatige override van het begrote bedrag
 * (UX §9.3: "alleen jaarcanon en indexatiepercentage worden ingevoerd").
 */

export type BgCanonErfpachtControleErnst = BgControleErnst;

export interface BgCanonErfpachtControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed. */
  regelIndex: number | null;
  ernst: BgCanonErfpachtControleErnst;
  bericht: string;
}

export interface BgCanonErfpachtRegelInvoer {
  complexnummer: string;
  /** Verplicht, leidend voor de P&L-post (code, nooit omschrijving). */
  grootboekrekening: string;
  /** Optioneel, onafhankelijk van `grootboekrekening`. */
  ogbKostensoort?: string | null;
  /** `null` = niet ingevuld. Expliciet `Decimal(0)` = bewust geen erfpacht. */
  jaarcanon: Decimal | null;
  /** Hele procenten (3 = 3%). `null` = niet ingevuld; niet vereist bij jaarcanon €0. */
  indexPercentage: Decimal | null;
}

export interface BgCanonErfpachtAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
}

export type BgCanonErfpachtReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgCanonErfpachtRegelUitkomst {
  index: number;
  invoer: BgCanonErfpachtRegelInvoer;
  /** Veilige, meetellende bijdrage: onvolledige rekenvelden zijn hier naar 0 herleid; negatieve waarden blijven ongewijzigd. */
  begrootBedrag: Decimal;
}

export interface BgCanonErfpachtResultaat {
  begrotingsjaar: number;
  beoordeeld: boolean;
  reviewStatus: BgCanonErfpachtReviewStatus;
  regels: BgCanonErfpachtRegelUitkomst[];
  totaalJaar: Decimal;
  controleVereist: BgCanonErfpachtControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function leeg(waarde: string): boolean {
  return waarde.trim().length === 0;
}

function berekenRegel(
  invoer: BgCanonErfpachtRegelInvoer,
  index: number,
): { uitkomst: BgCanonErfpachtRegelUitkomst; controleVereist: BgCanonErfpachtControleItem[] } {
  const controleVereist: BgCanonErfpachtControleItem[] = [];
  const meld = (bericht: string, ernst: BgCanonErfpachtControleErnst = "KRITIEK") => controleVereist.push({ regelIndex: index, ernst, bericht });

  if (leeg(invoer.complexnummer)) {
    meld(`Regel ${index}: complexnummer ontbreekt — verplicht (één regel per bestaand complex).`);
  }
  if (leeg(invoer.grootboekrekening)) {
    meld(`Regel ${index}: grootboekrekening ontbreekt — verplicht voor vaststellen.`);
  }

  let begrootBedrag = new Decimal(0);
  const canon = invoer.jaarcanon;
  const indexering = invoer.indexPercentage;

  if (canon === null) {
    meld(`Regel ${index}: jaarcanon ontbreekt — verplicht (bewust €0 = expliciet 0 invullen); veilige bijdrage 0 toegepast.`);
  } else if (canon.isNaN()) {
    meld(`Regel ${index}: jaarcanon is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (canon.isZero()) {
    // Bewust geen erfpacht: geldig, indexering niet vereist, bedrag blijft €0.
  } else {
    if (canon.isNegative()) {
      meld(`Regel ${index}: jaarcanon is negatief (${canon.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
    if (indexering === null) {
      meld(`Regel ${index}: indexatiepercentage ontbreekt — berekening niet mogelijk (geen geraden 0%), veilige bijdrage 0 toegepast.`);
    } else if (indexering.isNaN()) {
      meld(`Regel ${index}: indexatiepercentage is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
    } else {
      if (indexering.isNegative()) {
        meld(`Regel ${index}: indexatiepercentage is negatief (${indexering.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
      }
      begrootBedrag = canon.times(new Decimal(1).plus(indexering.dividedBy(100)));
    }
  }

  return { uitkomst: { index, invoer, begrootBedrag }, controleVereist };
}

export function berekenBegroteCanonErfpacht(
  regelsInvoer: readonly BgCanonErfpachtRegelInvoer[],
  aannames: BgCanonErfpachtAannames,
): BgCanonErfpachtResultaat {
  const controleVereist: BgCanonErfpachtControleItem[] = [];
  const regels = regelsInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenRegel(invoer, index);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const gezien = new Map<string, number>();
  regels.forEach((regel, index) => {
    const sleutel = regel.invoer.complexnummer.trim();
    if (sleutel.length === 0) return;
    const eerder = gezien.get(sleutel);
    if (eerder !== undefined) {
      controleVereist.push({
        regelIndex: index,
        ernst: "KRITIEK",
        bericht: `Regel ${index}: complex ${sleutel} komt meerdere keren voor (eerder in regel ${eerder}) — één regel per bestaand complex; bedrag blijft meetellen.`,
      });
    } else {
      gezien.set(sleutel, index);
    }
  });

  const reviewStatus: BgCanonErfpachtReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_RULES"
      : "REVIEWED_WITH_RULES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    regels,
    totaalJaar: som(regels.map((r) => r.begrootBedrag)),
    controleVereist,
  };
}
