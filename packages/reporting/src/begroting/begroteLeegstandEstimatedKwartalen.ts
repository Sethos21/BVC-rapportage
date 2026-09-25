import Decimal from "decimal.js";
import type { BgOnderhoudKwartaal } from "./begroteGeplandOnderhoudEstimated.js";
import { LEEGSTAND_CATEGORIEEN, type BgLeegstandCategorie } from "./begroteLeegstand.js";

/**
 * Handmatige RESTERENDE VERWACHTING Leegstandskosten op de vastgestelde kwartaalstructuur (Vervolgtranche 8; FO OB-031/030):
 * per kostensoort (Nuts, Servicekosten, Overige) een bedrag per Q1–Q4, ingevoerd voor de kwartalen die nog komen. De som over
 * de RESTERENDE kwartalen is de `verwachtingResterendJaar` die `berekenEstimatedLeegstand` verwacht.
 *
 * - Geen kunstmatige verdeling van Werkelijk over kwartalen: Werkelijk t/m de afgesloten periode blijft één bedrag per
 *   kostensoort. Een ingevoerd bedrag voor een AL AFGESLOTEN kwartaal wordt genegeerd (Werkelijk dekt dat kwartaal al —
 *   meetellen zou dubbel tellen) en als INFORMATIEF gemeld.
 * - `null` (niet ingevuld) is nooit €0: is één van de resterende kwartalen van een kostensoort leeg (of NaN), dan is de
 *   verwachting van die kostensoort `null` (onbekend). Een expliciete `Decimal(0)` is een bewuste €0 en geldig.
 * - Zijn er geen resterende kwartalen (jaar afgesloten), dan is de verwachting een bekende €0.
 * - Geen voorspelling uit contractdata, geen koppeling met servicekostenbegroting of voorschotten.
 */

export interface LeegstandEstimatedKwartaalInvoer {
  q1: Decimal | null;
  q2: Decimal | null;
  q3: Decimal | null;
  q4: Decimal | null;
}

export interface LeegstandEstimatedControleItem {
  ernst: "INFORMATIEF" | "WAARSCHUWING";
  bericht: string;
}

export interface LeegstandResterendeVerwachtingResultaat {
  verwachtingPerCategorie: Record<BgLeegstandCategorie, Decimal | null>;
  resterendeKwartalen: BgOnderhoudKwartaal[];
  controleVereist: LeegstandEstimatedControleItem[];
}

const KWARTALEN: readonly BgOnderhoudKwartaal[] = ["Q1", "Q2", "Q3", "Q4"];
const veld = (invoer: LeegstandEstimatedKwartaalInvoer, kwartaal: BgOnderhoudKwartaal): Decimal | null => invoer[kwartaal.toLowerCase() as "q1" | "q2" | "q3" | "q4"];
const isGeldig = (w: Decimal | null): w is Decimal => w !== null && !w.isNaN();

export function bepaalLeegstandResterendeVerwachting(
  invoer: Record<BgLeegstandCategorie, LeegstandEstimatedKwartaalInvoer>,
  resterendeKwartalenInvoer: readonly BgOnderhoudKwartaal[],
): LeegstandResterendeVerwachtingResultaat {
  for (const k of resterendeKwartalenInvoer) {
    if (!KWARTALEN.includes(k)) throw new Error(`Ongeldig resterend kwartaal "${String(k)}" — verwacht Q1..Q4.`);
  }
  if (new Set(resterendeKwartalenInvoer).size !== resterendeKwartalenInvoer.length) {
    throw new Error("Een resterend kwartaal komt meerdere keren voor — geen dubbele telling.");
  }
  const resterend = KWARTALEN.filter((k) => resterendeKwartalenInvoer.includes(k));
  const afgesloten = KWARTALEN.filter((k) => !resterend.includes(k));

  const controleVereist: LeegstandEstimatedControleItem[] = [];
  const verwachtingPerCategorie = {} as Record<BgLeegstandCategorie, Decimal | null>;
  for (const categorie of LEEGSTAND_CATEGORIEEN) {
    const bedragen = resterend.map((k) => veld(invoer[categorie], k));
    verwachtingPerCategorie[categorie] = bedragen.every(isGeldig) ? bedragen.reduce((som, b) => som.plus(b), new Decimal(0)) : null;
    for (const k of afgesloten) {
      if (isGeldig(veld(invoer[categorie], k))) {
        controleVereist.push({ ernst: "INFORMATIEF", bericht: `${categorie}: bedrag voor afgesloten kwartaal ${k} genegeerd — Werkelijk dekt dat kwartaal al (geen dubbele telling).` });
      }
    }
    if (verwachtingPerCategorie[categorie] === null) {
      controleVereist.push({ ernst: "WAARSCHUWING", bericht: `${categorie}: resterende verwachting nog niet volledig ingevuld (${resterend.filter((k) => !isGeldig(veld(invoer[categorie], k))).join(", ")}) — onbekend, niet €0.` });
    }
  }
  return { verwachtingPerCategorie, resterendeKwartalen: resterend, controleVereist };
}
