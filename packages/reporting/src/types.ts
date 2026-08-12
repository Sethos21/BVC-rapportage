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
