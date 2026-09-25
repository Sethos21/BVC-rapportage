import Decimal from "decimal.js";
import type { Balansstand, Boekingsregel, GrootboekMapping, OnbekendOf } from "./types.js";

/**
 * Centrale berekeningen uit 04_BEREKENINGSDEFINITIES_v0.3.md.
 * Regel: dit zijn de ENIGE plekken waar deze formules mogen staan
 * (rapporten/exports/AI hergebruiken deze functies, geen eigen lokale
 * herberekening — AP-04, AP-11). Nooit Math.abs() gebruiken om
 * economische betekenis of balanszijde te bepalen (BVC Financiele
 * grondslagen v0.4).
 */

/** CAL-FIN-001 — Boeking_Saldo = debet - credit. */
export function boekingSaldo(boeking: Pick<Boekingsregel, "bedragDebet" | "bedragCredit">): Decimal {
  return boeking.bedragDebet.minus(boeking.bedragCredit);
}

/** CAL-FIN-002 — Rapportbedrag = Boeking_Saldo x presentatiefactor. Vereist een geldige mapping. */
export function rapportbedrag(saldo: Decimal, mapping: Pick<GrootboekMapping, "presentatiefactor">): Decimal {
  return saldo.times(mapping.presentatiefactor);
}

/** CAL-FIN-003 — Rapportregelsom = som van rapportbedragen op de laagste geldige korrel. */
export function rapportregelsom(rapportbedragen: readonly Decimal[]): Decimal {
  return rapportbedragen.reduce((totaal, bedrag) => totaal.plus(bedrag), new Decimal(0));
}

/** CAL-FIN-005 — Balansreconciliatie = beginstand + mutaties - eindstand. Moet 0 zijn binnen tolerantie. */
export function balansreconciliatie(beginstand: Decimal, mutaties: Decimal, eindstand: Decimal): Decimal {
  return beginstand.plus(mutaties).minus(eindstand);
}

export interface BoekstukControleResultaat {
  bedrijfsnr: string;
  boekstukSleutel: string;
  som: Decimal;
  sluitBinnenTolerantie: boolean;
}

/**
 * CAL-FIN-006 — Boekstukcontrole: SUM(Boeking_Saldo) per Bedrijfsnr + Boekstuk_Sleutel
 * moet 0 zijn binnen de vastgestelde tolerantie (PAR-CTRL-002, pilot-startwaarde €0,01).
 */
export function boekstukcontrole(
  boekingen: readonly Boekingsregel[],
  toleranceEuro: Decimal,
): BoekstukControleResultaat[] {
  const perBoekstuk = new Map<string, { bedrijfsnr: string; boekstukSleutel: string; som: Decimal }>();

  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const bestaand = perBoekstuk.get(key);
    const saldo = boekingSaldo(boeking);
    if (bestaand) {
      bestaand.som = bestaand.som.plus(saldo);
    } else {
      perBoekstuk.set(key, { bedrijfsnr: boeking.bedrijfsnr, boekstukSleutel: boeking.boekstukSleutel, som: saldo });
    }
  }

  return Array.from(perBoekstuk.values()).map((entry) => ({
    ...entry,
    sluitBinnenTolerantie: entry.som.abs().lessThanOrEqualTo(toleranceEuro),
  }));
}

/** CAL-FIN-007 — Periodevergelijking = huidige periode - vergelijkingsperiode (absolute verandering). */
export function periodevergelijking(huidig: Decimal, vergelijking: Decimal): Decimal {
  return huidig.minus(vergelijking);
}

/**
 * CAL-FIN-008 — Procentuele verandering = verschil / ABS(vergelijkingswaarde) x 100%.
 * Onbekend bij nul of onbekende noemer (geen impliciete 0%).
 */
export function procentueleVerandering(
  verschil: Decimal,
  vergelijkingswaarde: OnbekendOf<Decimal>,
): OnbekendOf<Decimal> {
  if (vergelijkingswaarde.type === "onbekend") {
    return { type: "onbekend", reden: `vergelijkingswaarde onbekend: ${vergelijkingswaarde.reden}` };
  }
  if (vergelijkingswaarde.waarde.isZero()) {
    return { type: "onbekend", reden: "vergelijkingswaarde is nul" };
  }
  return {
    type: "bekend",
    waarde: verschil.dividedBy(vergelijkingswaarde.waarde.abs()).times(100),
  };
}

export interface BegrotingswaardeResultaat {
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  fy: Decimal;
  methode: "KWARTAAL" | "TIJDSEVENREDIG";
}

/**
 * Begrotingswaarde per periode (BVC_Begrotingsformat_v0.2, "Zo vul je de
 * begroting in"): zijn alle kwartalen ingevuld, dan is de som van de
 * kwartalen leidend. Zijn alle kwartalen leeg en bestaat een jaarbedrag,
 * verdeel tijdsevenredig over vier kwartalen. Meng nooit beide methodes
 * binnen één post; een gedeeltelijk ingevuld kwartaalpatroon is een fout,
 * geen berekening (de rapportagetool verzint geen ontbrekend kwartaal).
 */
export function berekenBegrotingswaarde(
  q1: Decimal | null,
  q2: Decimal | null,
  q3: Decimal | null,
  q4: Decimal | null,
  jaarbedrag: Decimal | null,
): OnbekendOf<BegrotingswaardeResultaat> {
  const kwartalen = [q1, q2, q3, q4];
  const aantalIngevuld = kwartalen.filter((k) => k !== null).length;

  if (aantalIngevuld === 4) {
    const [k1, k2, k3, k4] = kwartalen as [Decimal, Decimal, Decimal, Decimal];
    return { type: "bekend", waarde: { q1: k1, q2: k2, q3: k3, q4: k4, fy: k1.plus(k2).plus(k3).plus(k4), methode: "KWARTAAL" } };
  }
  if (aantalIngevuld === 0) {
    if (jaarbedrag === null) {
      return { type: "onbekend", reden: "geen kwartalen en geen jaarbedrag ingevuld" };
    }
    const kwart = jaarbedrag.dividedBy(4);
    return { type: "bekend", waarde: { q1: kwart, q2: kwart, q3: kwart, q4: kwart, fy: jaarbedrag, methode: "TIJDSEVENREDIG" } };
  }
  return { type: "onbekend", reden: `gedeeltelijk ingevulde kwartalen (${aantalIngevuld} van 4) — Controle vereist, geen aanname toegestaan` };
}

/** CAL-FIN-009 — Budgetafwijking = realisatie - budget. Alleen met goedgekeurde begrotingsversie. */
export function budgetafwijking(realisatie: Decimal, budget: Decimal): Decimal {
  return realisatie.minus(budget);
}

/** CAL-FIN-010 — Budgetafwijking % = (realisatie - budget) / ABS(budget) x 100%. Onbekend bij nul/onbekend budget. */
export function budgetafwijkingPct(realisatie: Decimal, budget: OnbekendOf<Decimal>): OnbekendOf<Decimal> {
  if (budget.type === "onbekend") {
    return { type: "onbekend", reden: `budget onbekend: ${budget.reden}` };
  }
  if (budget.waarde.isZero()) {
    return { type: "onbekend", reden: "budget is nul" };
  }
  const afwijking = budgetafwijking(realisatie, budget.waarde);
  return { type: "bekend", waarde: afwijking.dividedBy(budget.waarde.abs()).times(100) };
}

/**
 * BVC Financiele grondslagen v0.4 — vaste balansaansluiting:
 * beginstand bank + netto bankmutaties = eindstand bank (blokkerende controle).
 */
export function bankaansluiting(
  beginstand: Decimal,
  nettoMutaties: Decimal,
  eindstand: Decimal,
  toleranceEuro: Decimal,
): { verschil: Decimal; sluitBinnenTolerantie: boolean } {
  const verschil = balansreconciliatie(beginstand, nettoMutaties, eindstand);
  return { verschil, sluitBinnenTolerantie: verschil.abs().lessThanOrEqualTo(toleranceEuro) };
}

/**
 * Bepaalt of iedere gebruikte grootboekrekening met niet-nul saldo een
 * geldige GOEDGEKEURD-mapping heeft (PAR-MAP-001: 0 toegestane niet-gemapte
 * realisatie). Retourneert de rekeningen die publicatie blokkeren.
 */
export function nietGemapteRekeningenMetSaldo(
  balansstanden: readonly Balansstand[],
  goedgekeurdeMappings: ReadonlySet<string>,
): Balansstand[] {
  return balansstanden.filter((stand) => {
    const heeftSaldo = !stand.eindsaldo.isZero();
    const sleutel = `${stand.bedrijfsnr}::${stand.grootboekrekeningnr}`;
    return heeftSaldo && !goedgekeurdeMappings.has(sleutel);
  });
}
