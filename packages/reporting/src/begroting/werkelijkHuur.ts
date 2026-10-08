import Decimal from "decimal.js";

/**
 * Werkelijk Huur — FASE GAT-002B (2026-09-16): de EERSTE Werkelijk-laag voor
 * de economische module HUUR (`PNL_ECONOMISCHE_MODULES`, `pnlBronmapping.ts`).
 *
 * DIT IS GEEN CONTRACT-/RENTROLL-/MODULE-1-BEREKENING (GAT-002B-opdracht §1/
 * §2): `begroteHuuropbrengsten.ts` ("Module 1") berekent BEGROTE huur uit
 * contracten/rentroll-mutaties — een fundamenteel andere bron met een eigen,
 * uitgebreid bewezen rekenmodel (pro-rata, indexatie, VS=13-korting). Deze
 * module doet daar NIETS mee: WERKELIJKE huur komt uitsluitend uit
 * Boekingen, exact hetzelfde architectuurprincipe als Onderhoud (M7,
 * `werkelijkOnderhoud.ts`) — een standalone Werkelijk-calculator die de
 * bestaande Begrotingsmodule niet aanraakt en er niet van afhangt.
 *
 * BEWEZEN BRONMAPPING (GAT-002B-opdracht §3, bevestigd tegen
 * `packages/config/README.md`): GL8800 → Huuropbrengsten belast, GL8801 →
 * Huuropbrengsten onbelast, GL8805 → Verleende huurkorting — alle drie
 * geclassificeerd als "Opbrengsten" met tekenconventie "OMGEKEERD" (credit-
 * normaal, bron toont een negatief saldo voor een normale opbrengstboeking).
 * Zie `huurCentraleMapping.ts` voor de bron-naar-categorie-vertaling.
 *
 * TEKENSEMANTIEK (GAT-002B-opdracht §7) — GEEN SIGN-FLIP IN DEZE CALCULATOR:
 * exact hetzelfde principe als Rente/Leegstand/Onderhoud — `saldo` is al door
 * de aanroeper correct bepaald (debet − credit, CAL-FIN-001) en wordt hier
 * ONGEWIJZIGD gesommeerd. De categorieTotalen komen daarom in hun RUWE
 * bronrichting: HUUROPBRENGST_BELAST/HUUROPBRENGST_ONBELAST negatief (normale
 * credit-boeking op een credit-normale opbrengstrekening), VERLEENDE_HUURKORTING
 * positief (een korting is een debitering — dus tegengesteld — van diezelfde
 * credit-normale rekeningsoort). De ÉÉN normalisatie naar een voor mensen
 * leesbare, P&L-conforme richting (belast/onbelast positief, korting negatief
 * als aftrekpost) gebeurt uitsluitend in `huurWerkelijkPnLAdapter.ts`, NOOIT
 * hier — zie die module voor de volledige onderbouwing.
 *
 * NIEUW ARCHITECTUURPATROON (M7-precedent): deze calculator kent GEEN
 * grootboekrekening/OGB, GEEN administratiecode, GEEN vrije tekst, GEEN
 * bedrag-gebaseerde heuristiek — puur economische betekenis in
 * (`economischeCategorie`, al bepaald door de centrale resolver), economisch
 * resultaat uit.
 *
 * GEEN ESTIMATED IN DEZE FASE (GAT-002B-opdracht §11, expliciet buiten
 * scope): uitsluitend Werkelijk wordt gebouwd.
 */

export const HUUR_WERKELIJK_CATEGORIEEN = ["HUUROPBRENGST_BELAST", "HUUROPBRENGST_ONBELAST", "VERLEENDE_HUURKORTING"] as const;
export type HuurWerkelijkCategorie = (typeof HUUR_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkHuurBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: HuurWerkelijkCategorie | null;
  saldo: Decimal;
}

export interface WerkelijkHuurCategorieResultaat {
  categorie: HuurWerkelijkCategorie;
  /** Ruwe, ongenormaliseerde som (CAL-FIN-001) — zie moduledoc voor de tekenrichting per categorie. */
  categorieTotaal: Decimal;
}

export interface WerkelijkHuurResultaat {
  /** Vaste volgorde: `HUUR_WERKELIJK_CATEGORIEEN`. */
  perCategorie: WerkelijkHuurCategorieResultaat[];
  /** Ruwe som van de drie categorieTotalen — GEEN P&L-genormaliseerd nettobedrag (dat is de adapter, zie moduledoc). */
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/**
 * Groepeert reeds economisch geclassificeerde boekingen per Huur-categorie —
 * GEEN classificatielogica hierin (zie moduledoc).
 */
export function berekenWerkelijkHuur(boekingen: readonly WerkelijkHuurBoekingRegel[]): WerkelijkHuurResultaat {
  const perCategorieRegels = new Map<HuurWerkelijkCategorie, WerkelijkHuurBoekingRegel[]>(HUUR_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkHuurBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkHuurCategorieResultaat[] = HUUR_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    categorie,
    categorieTotaal: som(perCategorieRegels.get(categorie)!.map((r) => r.saldo)),
  }));

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
  };
}
