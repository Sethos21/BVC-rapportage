import Decimal from "decimal.js";

/**
 * Alleen-lezen diagnostiek (2026-09-11) — TIJDELIJK, GEEN KPI, GEEN
 * classificatie, GEEN begrotingslogica. Doel: voor één administratie en één
 * of meer grootboekrekeningen vaststellen in welke boekjaren/periodes er
 * ÜBERHAUPT boekingen voorkomen — bouwstap om, zonder boekjaren te gokken,
 * het juiste boekjaar te vinden voor een gerichte vervolgdiagnose (zoals
 * `boekingen-onderhoud-diagnose`) wanneer een laag-volume rekening (bv. een
 * eenmalige verkooptransactie, zie OB-039-bronfase) in geen van de al
 * geprobeerde boekjaren voorkomt. Rekent GEEN saldo-interpretatie/
 * classificatie toe — puur telling + min/max periode per boekjaar, op reeds
 * bedrijfsnr- en grootboekrekening-gefilterde regels.
 */

export interface BoekingenJarenRegel {
  grootboeknr: string;
  boekjaar: number;
  boekperiode: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
}

export interface BoekingenJarenPerJaarTotaal {
  boekjaar: number;
  eerstePeriode: string;
  laatstePeriode: string;
  aantalRegels: number;
  saldo: Decimal;
}

export interface BoekingenJarenGrootboekTotaal {
  grootboekrekening: string;
  aantalRegels: number;
  saldo: Decimal;
  /** Vaste volgorde: oplopend boekjaar. */
  perJaar: BoekingenJarenPerJaarTotaal[];
}

export interface BoekingenJarenTotaalPerJaar {
  boekjaar: number;
  aantalRegels: number;
  saldo: Decimal;
}

export interface BoekingenJarenDiagnoseResultaat {
  aantalRegels: number;
  /** Vaste volgorde: alfabetisch grootboekrekening. Rekeningen zonder enige boeking komen hier niet in voor. */
  perGrootboekrekening: BoekingenJarenGrootboekTotaal[];
  /** Som over ALLE opgegeven grootboekrekeningen samen, per boekjaar — puur oriënterend, geen vervanging van `perGrootboekrekening`. */
  totaalPerBoekjaar: BoekingenJarenTotaalPerJaar[];
}

function saldoVan(r: BoekingenJarenRegel): Decimal {
  return r.bedragDebet.minus(r.bedragCredit);
}

function som(regels: readonly BoekingenJarenRegel[]): Decimal {
  return regels.reduce((acc, r) => acc.plus(saldoVan(r)), new Decimal(0));
}

export function diagnoseerBoekingenJaren(regels: readonly BoekingenJarenRegel[]): BoekingenJarenDiagnoseResultaat {
  const grootboekrekeningen = Array.from(new Set(regels.map((r) => r.grootboeknr))).sort();

  const perGrootboekrekening: BoekingenJarenGrootboekTotaal[] = grootboekrekeningen.map((gl) => {
    const rijenGl = regels.filter((r) => r.grootboeknr === gl);
    const boekjaren = Array.from(new Set(rijenGl.map((r) => r.boekjaar))).sort((a, b) => a - b);
    const perJaar: BoekingenJarenPerJaarTotaal[] = boekjaren.map((boekjaar) => {
      const rijenJaar = rijenGl.filter((r) => r.boekjaar === boekjaar);
      const periodes = rijenJaar.map((r) => r.boekperiode).sort();
      return {
        boekjaar,
        eerstePeriode: periodes[0]!,
        laatstePeriode: periodes[periodes.length - 1]!,
        aantalRegels: rijenJaar.length,
        saldo: som(rijenJaar),
      };
    });
    return {
      grootboekrekening: gl,
      aantalRegels: rijenGl.length,
      saldo: som(rijenGl),
      perJaar,
    };
  });

  const alleJaren = Array.from(new Set(regels.map((r) => r.boekjaar))).sort((a, b) => a - b);
  const totaalPerBoekjaar: BoekingenJarenTotaalPerJaar[] = alleJaren.map((boekjaar) => {
    const rijenJaar = regels.filter((r) => r.boekjaar === boekjaar);
    return { boekjaar, aantalRegels: rijenJaar.length, saldo: som(rijenJaar) };
  });

  return {
    aantalRegels: regels.length,
    perGrootboekrekening,
    totaalPerBoekjaar,
  };
}
