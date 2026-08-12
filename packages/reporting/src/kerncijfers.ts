import type Decimal from "decimal.js";
import { periodevergelijking, procentueleVerandering, telOpMetAfronding, type OnbekendOf } from "@bvc/domain";
import type { BezettingComplexRegel, HuurComplexRegel } from "./types.js";

/**
 * Berekeningen voor sectie "01 — Kerncijfers" (KPI-dashboard). Geen
 * berekeningen in de renderlaag (renderKerncijfers.ts) — alleen hier,
 * conform financieleberekeningen.md. Hergebruikt uitsluitend de centrale
 * @bvc/domain-functies (CAL-FIN-007/008); geen eigen lokale herberekening.
 */

export interface KpiMutatie {
  mutatieAbsoluut: Decimal;
  mutatiePct: OnbekendOf<Decimal>;
  /**
   * true = mutatie is gunstig nieuws (groene weergave), false =
   * aandachtspunt (amber). Voor opbrengstachtige KPI's (huur, EBITDA) is
   * stijgen gunstig; voor lastenachtige KPI's (debiteuren) is dalen
   * gunstig. De richting van de mutatie zelf blijft ongewijzigd — nooit
   * Math.abs() gebruiken om betekenis te bepalen.
   */
  gunstig: boolean;
}

export function berekenKpiMutatie(waarde: Decimal, vorig: Decimal, opbrengstAchtig: boolean): KpiMutatie {
  const mutatieAbsoluut = periodevergelijking(waarde, vorig);
  const mutatiePct = procentueleVerandering(mutatieAbsoluut, { type: "bekend", waarde: vorig });
  const stijging = !mutatieAbsoluut.isNegative();
  return { mutatieAbsoluut, mutatiePct, gunstig: opbrengstAchtig ? stijging : !stijging };
}

/** Bezettingsgraad = verhuurd m² / totaal m² × 100%. Onbekend bij totaal m² = 0 (geen deling door nul). */
export function berekenBezettingsgraad(verhuurdM2: Decimal, totaalM2: Decimal): OnbekendOf<Decimal> {
  if (totaalM2.isZero()) {
    return { type: "onbekend", reden: "totaal m² is nul" };
  }
  return { type: "bekend", waarde: verhuurdM2.dividedBy(totaalM2).times(100) };
}

export interface BezettingsgraadTotaal {
  verhuurdM2Totaal: Decimal;
  totaalM2Totaal: Decimal;
  bezettingsgraad: OnbekendOf<Decimal>;
}

export function berekenBezettingsgraadPortefeuille(regels: readonly BezettingComplexRegel[]): BezettingsgraadTotaal {
  const verhuurdM2Totaal = telOpMetAfronding(regels.map((r) => r.verhuurdM2));
  const totaalM2Totaal = telOpMetAfronding(regels.map((r) => r.totaalM2));
  return { verhuurdM2Totaal, totaalM2Totaal, bezettingsgraad: berekenBezettingsgraad(verhuurdM2Totaal, totaalM2Totaal) };
}

export interface HuurPerComplexTotaal {
  totaal: Decimal;
  totaalVorig: Decimal;
}

export function berekenHuurPerComplexTotaal(regels: readonly HuurComplexRegel[]): HuurPerComplexTotaal {
  return {
    totaal: telOpMetAfronding(regels.map((r) => r.waarde)),
    totaalVorig: telOpMetAfronding(regels.map((r) => r.vorig)),
  };
}
