import Decimal from "decimal.js";
import { telOpMetAfronding } from "@bvc/domain";
import type {
  ControlerapportBalansregel,
  ControlerapportBoekingsregel,
  ControlerapportServicekostenregel,
} from "./types.js";

/**
 * Berekeningen voor het Controlerapport — uitsluitend optellingen/
 * groeperingen op al-gevalideerde cacherijen, geen classificatie of
 * mapping (die bestaat nog niet, zie types.ts). Geen berekeningen in de
 * renderlaag (renderControlerapport.ts).
 */

export interface GrootboekTotaal {
  grootboeknr: string;
  debet: Decimal;
  credit: Decimal;
  /** CAL-FIN-001: debet - credit, nooit de bronwaarde. */
  saldo: Decimal;
}

/** Groepeert boekingen per grootboeknr en telt debet/credit op, alfabetisch gesorteerd. */
export function berekenGrootboekTotalen(boekingen: readonly ControlerapportBoekingsregel[]): GrootboekTotaal[] {
  const perRekening = new Map<string, ControlerapportBoekingsregel[]>();
  for (const boeking of boekingen) {
    const groep = perRekening.get(boeking.grootboeknr) ?? [];
    groep.push(boeking);
    perRekening.set(boeking.grootboeknr, groep);
  }
  return Array.from(perRekening.entries())
    .map(([grootboeknr, regels]) => {
      const debet = telOpMetAfronding(regels.map((r) => r.bedragDebet));
      const credit = telOpMetAfronding(regels.map((r) => r.bedragCredit));
      return { grootboeknr, debet, credit, saldo: debet.minus(credit) };
    })
    .sort((a, b) => a.grootboeknr.localeCompare(b.grootboeknr));
}

export interface ServicekostenTotaal {
  kostensoort: string;
  omschrijving: string | null;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

/** Groepeert servicekosten per kostensoort — bewust zonder de 9600-uitsluitingsregel toe te passen (zie types.ts). */
export function berekenServicekostenPerKostensoort(regels: readonly ControlerapportServicekostenregel[]): ServicekostenTotaal[] {
  const perKostensoort = new Map<string, ControlerapportServicekostenregel[]>();
  for (const regel of regels) {
    const groep = perKostensoort.get(regel.kostensoort) ?? [];
    groep.push(regel);
    perKostensoort.set(regel.kostensoort, groep);
  }
  return Array.from(perKostensoort.entries())
    .map(([kostensoort, groep]) => {
      const debet = telOpMetAfronding(groep.map((r) => r.bedragDebet));
      const credit = telOpMetAfronding(groep.map((r) => r.bedragCredit));
      return { kostensoort, omschrijving: groep[0]?.omschrijving ?? null, debet, credit, saldo: debet.minus(credit) };
    })
    .sort((a, b) => a.kostensoort.localeCompare(b.kostensoort));
}

/** Som van alle Eindsaldo-waarden — controlegetal om tegen de bestaande rapportage te leggen. */
export function berekenBalansTotaalEindsaldo(balansstanden: readonly ControlerapportBalansregel[]): Decimal {
  return telOpMetAfronding(balansstanden.map((b) => b.eindsaldo));
}
