import type Decimal from "decimal.js";

/**
 * Kernentiteiten zoals vastgelegd in
 * 02_BVC_DATAMODEL_DEEL_2_LOGISCH_DATAMODEL_v0.3.md.
 * Alleen de velden die de Fase-1 (import/staging/berekeningen) nodig heeft.
 */

export interface Boekingsregel {
  bedrijfsnr: string;
  boekjaar: number;
  dagboeknr: string;
  boekstuknr: string;
  volgnr: string;
  boekstukSleutel: string;
  grootboeknr: string;
  boekdatum: Date;
  omschrijving: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  complexnr?: string | undefined;
  unitnr?: string | undefined;
  contractnr?: string | undefined;
}

export interface Balansstand {
  bedrijfsnr: string;
  jaar: number;
  grootboekrekeningnr: string;
  saldoDebet: Decimal;
  saldoCredit: Decimal;
  eindsaldo: Decimal;
}

/** Rapportmapping-status; zie GROOTBOEKMAPPING_SPEC_v0.1.md. Alleen GOEDGEKEURD mag in definitieve output. */
export type MappingStatus = "VOORGESTELD" | "TE_BEOORDELEN" | "GOEDGEKEURD" | "VERVALLEN";

export type BalansOfResultaat = "BALANS" | "RESULTAAT";

export interface GrootboekMapping {
  bedrijfsnr: string;
  grootboekrekening: string;
  balansOfResultaat: BalansOfResultaat;
  rapportcode: string;
  /** Uitsluitend 1 of -1 (BVC Financiele grondslagen v0.4). */
  presentatiefactor: 1 | -1;
  geldigVanaf: Date;
  geldigTot?: Date | undefined;
  status: MappingStatus;
  versie: string;
}

/** Een waarde die niet stilzwijgend 0 mag worden wanneer de bron/mapping/definitie ontbreekt. */
export type OnbekendOf<T> = { type: "bekend"; waarde: T } | { type: "onbekend"; reden: string };
