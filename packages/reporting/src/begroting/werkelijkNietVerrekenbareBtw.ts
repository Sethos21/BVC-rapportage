import Decimal from "decimal.js";

/**
 * Werkelijk Niet verrekenbare BTW — Vervolgtranche 9 Deel B: de Werkelijk-laag
 * voor de economische module NIET_VERREKENBARE_BTW (`PNL_ECONOMISCHE_MODULES`,
 * `pnlBronmapping.ts`).
 *
 * BEWEZEN BRONMAPPING (Master Contract, hergebruik bestaand bewijs): voor
 * administratie 070 is GL4903 eerder bewezen als bron voor Niet verrekenbare
 * BTW (`packages/config/README.md`: GL4903 "Niet verrekenbare BTW", RESULTAAT/
 * Kosten/ZOALS_BRON). GEEN GL4903-hardcoding als generieke waarheid voor
 * andere administraties — de concrete mapping komt uitsluitend via de
 * bestaande, administratiegebonden `PnLBronmappingRegel[]` (zie
 * `nietVerrekenbareBtwCentraleMapping.ts`), nooit als constante in deze
 * module.
 *
 * ÉÉN CATEGORIE (zelfde precedent als Management/Beheer/Gemeentelijke Lasten):
 * de bron kent geen bewezen sub-splitsing — exact één Werkelijk-categorie,
 * `NIET_VERREKENBARE_BTW`.
 *
 * TEKENSEMANTIEK — GEEN SIGN-FLIP IN DEZE CALCULATOR (zelfde principe als
 * Rente/Leegstand/Onderhoud/Management/Servicekosten Eigenaar): `saldo` is al
 * door de aanroeper correct bepaald (debet − credit, CAL-FIN-001) en wordt
 * hier ONGEWIJZIGD gesommeerd. Eventuele normalisatie naar de Pure P&L Engine
 * gebeurt uitsluitend in `nietVerrekenbareBtwPnLAdapters.ts`.
 *
 * GEEN ESTIMATED IN DEZE MODULE: de Estimated-methodiek voor Niet verrekenbare
 * BTW is bewust NIET contractueel eenduidig vastgesteld (STOP:
 * BUSINESSBESLISSING, zie `nietVerrekenbareBtwPnLAdapters.ts`) — uitsluitend
 * Werkelijk wordt hier gebouwd.
 */

export const NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN = ["NIET_VERREKENBARE_BTW"] as const;
export type NietVerrekenbareBtwWerkelijkCategorie = (typeof NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkNietVerrekenbareBtwBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: NietVerrekenbareBtwWerkelijkCategorie | null;
  saldo: Decimal;
}

export interface WerkelijkNietVerrekenbareBtwCategorieResultaat {
  categorie: NietVerrekenbareBtwWerkelijkCategorie;
  categorieTotaal: Decimal;
}

export interface WerkelijkNietVerrekenbareBtwResultaat {
  /** Vaste volgorde: `NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: WerkelijkNietVerrekenbareBtwCategorieResultaat[];
  /** Gelijk aan de ene categorieTotaal — hier uitsluitend als afgeleid gemak, geen aparte boekingscategorie. */
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/** Groepeert reeds economisch geclassificeerde boekingen naar de ene categorie — GEEN classificatielogica hierin (zie moduledoc). */
export function berekenWerkelijkNietVerrekenbareBtw(boekingen: readonly WerkelijkNietVerrekenbareBtwBoekingRegel[]): WerkelijkNietVerrekenbareBtwResultaat {
  const perCategorieRegels = new Map<NietVerrekenbareBtwWerkelijkCategorie, WerkelijkNietVerrekenbareBtwBoekingRegel[]>(NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkNietVerrekenbareBtwBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkNietVerrekenbareBtwCategorieResultaat[] = NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN.map((categorie) => ({
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
