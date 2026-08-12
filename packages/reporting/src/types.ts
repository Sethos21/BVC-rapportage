import type Decimal from "decimal.js";

/**
 * Invoer voor de P&L-exploitatierapportage per vastgoedobject
 * (FinancieelRapport-scope: CLAUDE.md-sjabloon, testcase object 070
 * "Rooise Zoom"). Bedragen zijn al op centrale, geldige bronnen gebaseerd
 * — deze module rekent zelf niets uit de ruwe bron, alleen met reeds
 * gevalideerde jaarcijfers.
 */

export interface PLPost {
  naam: string;
  bedrag: Decimal;
}

export interface PLJaarcijfers {
  jaar: number;
  huurinkomstenPerEenheid: PLPost[];
  kostenPerCategorie: PLPost[];
  /** Vrije toelichting per jaar, optioneel. */
  toelichting?: string;
}

export interface PLRapportInvoer {
  objectnaam: string;
  objectnummer: string;
  jaren: PLJaarcijfers[];
}

/**
 * Invoer voor sectie "01 — Kerncijfers" (KPI-dashboard), zie
 * `legacy/index.html`'s `renderOverzicht` (bevestigde spec, packages/reporting/README.md).
 * Alle bedragen en m²-waarden zijn al gevalideerde/opgetelde cijfers —
 * mutaties/percentages worden in `kerncijfers.ts` berekend, niet hier.
 */

/** KPI met een huidige waarde en de waarde van de vergelijkingsperiode (bv. vorig jaar). */
export interface KpiWaarde {
  waarde: Decimal;
  vorig: Decimal;
}

export interface UitbetalingsratioKpi {
  /** Fractie 0–1 (niet al ×100). */
  waarde: Decimal;
  /** Norm-fractie 0–1, bv. 0.85 voor "norm < 85%". */
  norm: Decimal;
}

export interface BankstandKpi {
  waarde: Decimal;
  streefwaarde: Decimal;
}

export interface KerncijfersKpis {
  huurinkomen: KpiWaarde;
  ebitda: KpiWaarde;
  uitbetalingsratio: UitbetalingsratioKpi;
  bankstand: BankstandKpi;
  debiteuren: KpiWaarde;
  /** Positief = tekort (kosten > voorschotten), negatief/nul = overschot. */
  servicekostenSaldo: Decimal;
}

export interface HuurKwartaalPunt {
  jaar: number;
  /** Weergavelabel voor de balk, bv. "Q2 2026". */
  label: string;
  waarde: Decimal;
}

export interface HuurComplexRegel {
  naam: string;
  waarde: Decimal;
  vorig: Decimal;
}

export interface BezettingComplexRegel {
  complex: string;
  verhuurdM2: Decimal;
  totaalM2: Decimal;
}

export interface KerncijfersInvoer {
  portefeuilleNaam: string;
  periodeLabel: string;
  kpis: KerncijfersKpis;
  huurPerKwartaal: HuurKwartaalPunt[];
  huurPerComplex: HuurComplexRegel[];
  bezettingPerComplex?: BezettingComplexRegel[] | undefined;
}
