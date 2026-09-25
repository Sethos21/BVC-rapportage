import Decimal from "decimal.js";

/**
 * Werkelijk Beheer — FASE GAT-002C (2026-09-16): de EERSTE Werkelijk-laag
 * voor de economische module BEHEER (`PNL_ECONOMISCHE_MODULES`,
 * `pnlBronmapping.ts`).
 *
 * DIT IS GEEN HERBEREKENING VAN MODULE 2 (GAT-002C-opdracht §2): `begroteBeheersvergoeding.ts`
 * ("Module 2") berekent de BEGROTE beheersvergoeding uit een eigen
 * vergoedingslogica (percentage/staffel over een grondslag) — een
 * fundamenteel andere bron dan de boekhouding. Deze module doet daar NIETS
 * mee: WERKELIJKE beheerkosten komen uitsluitend uit Boekingen, exact
 * hetzelfde architectuurprincipe als Huur (GAT-002B, `werkelijkHuur.ts`) en
 * Onderhoud (M7, `werkelijkOnderhoud.ts`) — een standalone Werkelijk-
 * calculator die de bestaande Begrotingsmodule niet aanraakt en er niet van
 * afhangt.
 *
 * BEWEZEN BRONMAPPING (GAT-002C-opdracht, bronproef tegen de echte 070-cache
 * — `rekeningactiviteit-4000-070-2026.json`, boekjaar 2026, periode 01-06):
 * GL4000 → BEHEER/BEHEERKOSTEN, uitsluitend GL-default (geen OGB-verfijning
 * aangeleverd/bewezen — de brondata draagt geen OGB-kostensoort). Q1 (t/m
 * boekperiode 03) = €1.979,17 + €1.148,41 = €3.127,58 (≈ €3.128 afgerond),
 * Q2 (t/m boekperiode 06) = €1.148,41 + €2.169,65 = €3.318,06 (≈ €3.318
 * afgerond), H1-totaal = €6.445,64 (≈ €6.446 afgerond) — reconcilieert exact
 * met de aangeleverde H1-2026-rapportagecijfers. Zie `beheerCentraleMapping.ts`
 * voor de bron-naar-categorie-vertaling.
 *
 * TEKENSEMANTIEK — GEEN SIGN-FLIP IN DEZE CALCULATOR (zelfde principe als
 * Rente/Leegstand/Onderhoud/Huur): `saldo` is al door de aanroeper correct
 * bepaald (debet − credit, CAL-FIN-001) en wordt hier ONGEWIJZIGD gesommeerd.
 * De bronproef-boekingen zijn ruw POSITIEF (€1.979,17/€1.148,41/€2.169,65 —
 * een normale debitering van een kostenrekening), consistent met de reeds
 * bewezen "kosten komen positief door"-conventie. Eventuele normalisatie
 * naar de Pure P&L Engine gebeurt uitsluitend in `beheerWerkelijkPnLAdapter.ts`.
 *
 * ÉÉN CATEGORIE (zelfde precedent als Gemeentelijke Lasten,
 * `begroteGemeentelijkeLasten.ts`): GL4000 kent geen bewezen sub-splitsing
 * (geen OGB-verfijning, geen ander onderscheidend brondatapunt) — de module
 * heeft daarom exact één Werkelijk-categorie, `BEHEERKOSTEN`.
 *
 * MANAGEMENTVERGOEDING BUITEN SCOPE (GAT-002C-opdracht, expliciet): deze
 * module bevat geen enkele MANAGEMENT-categorie of -logica.
 *
 * GEEN ESTIMATED IN DEZE FASE (expliciet buiten scope, GAT-002C-opdracht):
 * uitsluitend Werkelijk wordt gebouwd.
 */

export const BEHEER_WERKELIJK_CATEGORIEEN = ["BEHEERKOSTEN"] as const;
export type BeheerWerkelijkCategorie = (typeof BEHEER_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkBeheerBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: BeheerWerkelijkCategorie | null;
  saldo: Decimal;
}

export interface WerkelijkBeheerCategorieResultaat {
  categorie: BeheerWerkelijkCategorie;
  categorieTotaal: Decimal;
}

export interface WerkelijkBeheerResultaat {
  /** Vaste volgorde: `BEHEER_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: WerkelijkBeheerCategorieResultaat[];
  /** Gelijk aan de ene categorieTotaal — hier uitsluitend als afgeleid gemak, geen aparte boekingscategorie. */
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/**
 * Groepeert reeds economisch geclassificeerde boekingen naar de ene
 * Beheer-categorie — GEEN classificatielogica hierin (zie moduledoc).
 */
export function berekenWerkelijkBeheer(boekingen: readonly WerkelijkBeheerBoekingRegel[]): WerkelijkBeheerResultaat {
  const perCategorieRegels = new Map<BeheerWerkelijkCategorie, WerkelijkBeheerBoekingRegel[]>(BEHEER_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkBeheerBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkBeheerCategorieResultaat[] = BEHEER_WERKELIJK_CATEGORIEEN.map((categorie) => ({
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
