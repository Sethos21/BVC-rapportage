import Decimal from "decimal.js";

/**
 * Alleen-lezen diagnostiek (2026-09-04) — TIJDELIJK, GEEN KPI, GEEN
 * classificatie. Doel: vaststellen of `Boeking_OGB_Kostensoort` /
 * `Boeking_OGB_Kostensoort_Omschr` (gevonden via `boekingen-bronkolommen`,
 * nog GEEN onderdeel van `BoekingsregelBronSchema`) daadwerkelijk een
 * bruikbare exploitatie-classificatiedimensie vormen op de onderhouds-
 * grootboekrekeningen (4300/4330/4340), en of `Boeking_Complexnr`
 * betrouwbaar genoeg gevuld is om onderhoudsrealisatie per complex te
 * bepalen. Bouwt GEEN gepland-versus-dagelijks-classificatie — dat vraagt
 * menselijke interpretatie van de werkelijk aangetroffen codes/
 * omschrijvingen, niet een automatische regel.
 */

export interface OnderhoudBoekingRegel {
  boekjaar: number;
  boekperiode: string;
  boekdatum: Date | null;
  boekstukSleutel: string;
  dagboeknr: string;
  dagboekomschrijving: string | null;
  grootboeknr: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  omschrijving: string | null;
  ogbKostensoort: string | null;
  ogbKostensoortOmschrijving: string | null;
  complexnr: string | null;
  factuurnr: string | null;
  relatienr: string | null;
  relatienaam: string | null;
}

export interface OnderhoudBoekingenDiagnoseRegel extends OnderhoudBoekingRegel {
  saldo: Decimal;
}

export interface OnderhoudBoekingenDiagnoseGrootboekTotaal {
  grootboekrekening: string;
  aantalRegels: number;
  aantalOgbGevuld: number;
  aantalOgbLeeg: number;
  vullingspercentageOgb: number;
  uniekeOgbKostensoorten: string[];
  uniekeOgbKostensoortOmschrijvingen: string[];
  totaalSaldo: Decimal;
}

export interface OnderhoudBoekingenDiagnoseMatrixRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  ogbKostensoortOmschrijving: string | null;
  aantalRegels: number;
  totaalSaldo: Decimal;
}

export interface OnderhoudBoekingenDiagnoseComplexTotaal {
  complexnr: string;
  aantalRegels: number;
  totaalSaldo: Decimal;
  /** Bestaat dit complexnummer werkelijk in de authoritative complexbron (units)? */
  bekendInComplexbron: boolean;
}

export interface OnderhoudBoekingenDiagnoseComplexSectie {
  aantalGevuld: number;
  aantalLeeg: number;
  vullingspercentage: number;
  uniekeComplexnummers: string[];
  perComplex: OnderhoudBoekingenDiagnoseComplexTotaal[];
}

export interface OnderhoudBoekingenDiagnoseResultaat {
  aantalRegels: number;
  regels: OnderhoudBoekingenDiagnoseRegel[];
  perGrootboekrekening: OnderhoudBoekingenDiagnoseGrootboekTotaal[];
  matrixGrootboekOgbKostensoort: OnderhoudBoekingenDiagnoseMatrixRegel[];
  complex: OnderhoudBoekingenDiagnoseComplexSectie;
  totaalSaldoAlleRegels: Decimal;
}

function afgerondPercentage(teller: number, noemer: number): number {
  return noemer === 0 ? 0 : Math.round((teller / noemer) * 10000) / 100;
}

export function diagnoseerOnderhoudBoekingen(
  regels: readonly OnderhoudBoekingRegel[],
  bekendeComplexnummers: readonly string[],
): OnderhoudBoekingenDiagnoseResultaat {
  const bekendeComplexSet = new Set(bekendeComplexnummers);
  const metSaldo: OnderhoudBoekingenDiagnoseRegel[] = regels.map((r) => ({ ...r, saldo: r.bedragDebet.minus(r.bedragCredit) }));
  const gesorteerd = [...metSaldo].sort((a, b) => {
    if (a.boekdatum && b.boekdatum) return a.boekdatum.getTime() - b.boekdatum.getTime();
    if (a.boekdatum) return -1;
    if (b.boekdatum) return 1;
    return 0;
  });

  const grootboekrekeningen = Array.from(new Set(regels.map((r) => r.grootboeknr))).sort();
  const perGrootboekrekening: OnderhoudBoekingenDiagnoseGrootboekTotaal[] = grootboekrekeningen.map((gl) => {
    const rijenGl = metSaldo.filter((r) => r.grootboeknr === gl);
    const gevuld = rijenGl.filter((r) => r.ogbKostensoort !== null);
    const uniekeCodes = Array.from(new Set(gevuld.map((r) => r.ogbKostensoort as string))).sort();
    const uniekeOmschrijvingen = Array.from(
      new Set(gevuld.map((r) => r.ogbKostensoortOmschrijving).filter((v): v is string => v !== null)),
    ).sort();
    return {
      grootboekrekening: gl,
      aantalRegels: rijenGl.length,
      aantalOgbGevuld: gevuld.length,
      aantalOgbLeeg: rijenGl.length - gevuld.length,
      vullingspercentageOgb: afgerondPercentage(gevuld.length, rijenGl.length),
      uniekeOgbKostensoorten: uniekeCodes,
      uniekeOgbKostensoortOmschrijvingen: uniekeOmschrijvingen,
      totaalSaldo: rijenGl.reduce((acc, r) => acc.plus(r.saldo), new Decimal(0)),
    };
  });

  const matrixMap = new Map<string, OnderhoudBoekingenDiagnoseMatrixRegel>();
  for (const r of metSaldo) {
    const sleutel = `${r.grootboeknr}::${r.ogbKostensoort ?? ""}`;
    const bestaand = matrixMap.get(sleutel);
    if (bestaand) {
      bestaand.aantalRegels += 1;
      bestaand.totaalSaldo = bestaand.totaalSaldo.plus(r.saldo);
    } else {
      matrixMap.set(sleutel, {
        grootboekrekening: r.grootboeknr,
        ogbKostensoort: r.ogbKostensoort,
        ogbKostensoortOmschrijving: r.ogbKostensoortOmschrijving,
        aantalRegels: 1,
        totaalSaldo: r.saldo,
      });
    }
  }
  const matrixGrootboekOgbKostensoort = Array.from(matrixMap.values()).sort((a, b) =>
    a.grootboekrekening === b.grootboekrekening
      ? (a.ogbKostensoort ?? "").localeCompare(b.ogbKostensoort ?? "")
      : a.grootboekrekening.localeCompare(b.grootboekrekening),
  );

  const complexGevuld = metSaldo.filter((r) => r.complexnr !== null);
  const uniekeComplexnummers = Array.from(new Set(complexGevuld.map((r) => r.complexnr as string))).sort();
  const perComplexMap = new Map<string, { aantalRegels: number; totaalSaldo: Decimal }>();
  for (const r of complexGevuld) {
    const key = r.complexnr as string;
    const bestaand = perComplexMap.get(key);
    if (bestaand) {
      bestaand.aantalRegels += 1;
      bestaand.totaalSaldo = bestaand.totaalSaldo.plus(r.saldo);
    } else {
      perComplexMap.set(key, { aantalRegels: 1, totaalSaldo: r.saldo });
    }
  }
  const perComplex: OnderhoudBoekingenDiagnoseComplexTotaal[] = Array.from(perComplexMap.entries())
    .map(([complexnr, v]) => ({
      complexnr,
      aantalRegels: v.aantalRegels,
      totaalSaldo: v.totaalSaldo,
      bekendInComplexbron: bekendeComplexSet.has(complexnr),
    }))
    .sort((a, b) => a.complexnr.localeCompare(b.complexnr));

  return {
    aantalRegels: regels.length,
    regels: gesorteerd,
    perGrootboekrekening,
    matrixGrootboekOgbKostensoort,
    complex: {
      aantalGevuld: complexGevuld.length,
      aantalLeeg: metSaldo.length - complexGevuld.length,
      vullingspercentage: afgerondPercentage(complexGevuld.length, metSaldo.length),
      uniekeComplexnummers,
      perComplex,
    },
    totaalSaldoAlleRegels: metSaldo.reduce((acc, r) => acc.plus(r.saldo), new Decimal(0)),
  };
}
