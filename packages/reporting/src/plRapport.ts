import Decimal from "decimal.js";
import { periodevergelijking, procentueleVerandering, telOpMetAfronding, type OnbekendOf } from "@bvc/domain";
import type { PLJaarcijfers, PLRapportInvoer } from "./types.js";

/**
 * Centrale berekeningen voor de P&L-exploitatierapportage. Geen
 * berekeningen in de renderlaag (renderHtml.ts) — alleen hier, conform
 * financieleberekeningen.md ("Geen berekeningen in de UI-laag — altijd
 * in utils/services").
 */

export interface PLJaarTotalen {
  jaar: number;
  huurTotaal: Decimal;
  kostenTotaal: Decimal;
  nettoResultaat: Decimal;
}

export function berekenPLJaarTotalen(jaarcijfers: PLJaarcijfers): PLJaarTotalen {
  const huurTotaal = telOpMetAfronding(jaarcijfers.huurinkomstenPerEenheid.map((p) => p.bedrag));
  // Kostenposten worden als negatieve bedragen aangeleverd (huisstijlregel: kosten negatief).
  const kostenTotaal = telOpMetAfronding(jaarcijfers.kostenPerCategorie.map((p) => p.bedrag));
  return { jaar: jaarcijfers.jaar, huurTotaal, kostenTotaal, nettoResultaat: huurTotaal.plus(kostenTotaal) };
}

export function berekenPLTotalen(invoer: PLRapportInvoer): PLJaarTotalen[] {
  return invoer.jaren.map(berekenPLJaarTotalen);
}

export interface PLOveralTotaal {
  huurTotaal: Decimal;
  kostenTotaal: Decimal;
  nettoResultaat: Decimal;
}

export function berekenPLOveralTotaal(totalen: readonly PLJaarTotalen[]): PLOveralTotaal {
  return {
    huurTotaal: telOpMetAfronding(totalen.map((t) => t.huurTotaal)),
    kostenTotaal: telOpMetAfronding(totalen.map((t) => t.kostenTotaal)),
    nettoResultaat: telOpMetAfronding(totalen.map((t) => t.nettoResultaat)),
  };
}

export interface PLTrendpunt {
  jaar: number;
  mutatieAbsoluut: Decimal;
  mutatiePct: OnbekendOf<Decimal>;
}

/** Som van een lijst posten (bv. alle inkomsten- of kostenposten van één jaar), met afronding per stap. */
export function berekenPostenTotaal(posten: readonly { bedrag: Decimal }[]): Decimal {
  return telOpMetAfronding(posten.map((p) => p.bedrag));
}

/** Netto-resultaatmutatie t.o.v. het voorgaande jaar — het eerste jaar heeft geen trend. */
export function berekenPLTrend(totalen: readonly PLJaarTotalen[]): PLTrendpunt[] {
  const trend: PLTrendpunt[] = [];
  for (let i = 1; i < totalen.length; i++) {
    const huidig = totalen[i]!;
    const vorig = totalen[i - 1]!;
    const mutatieAbsoluut = periodevergelijking(huidig.nettoResultaat, vorig.nettoResultaat);
    trend.push({
      jaar: huidig.jaar,
      mutatieAbsoluut,
      mutatiePct: procentueleVerandering(mutatieAbsoluut, { type: "bekend", waarde: vorig.nettoResultaat }),
    });
  }
  return trend;
}
