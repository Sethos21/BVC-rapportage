import Decimal from "decimal.js";

/**
 * Werkelijk Management — FASE GAT-002D (2026-09-16): de EERSTE Werkelijk-laag
 * voor de economische module MANAGEMENT (`PNL_ECONOMISCHE_MODULES`,
 * `pnlBronmapping.ts`).
 *
 * DIT IS GEEN HERBEREKENING VAN DE BESTAANDE MANAGEMENTVERGOEDING-BEGROTING
 * (GAT-002D-opdracht): `begroteManagementvergoeding.ts` blijft ongewijzigd en
 * berekent de BEGROTE managementvergoeding uit een eigen formule/staffel —
 * een fundamenteel andere bron dan de boekhouding. Deze module doet daar
 * NIETS mee: WERKELIJKE managementkosten komen uitsluitend uit Boekingen,
 * exact hetzelfde architectuurprincipe als Beheer (GAT-002C,
 * `werkelijkBeheer.ts`) en Huur (GAT-002B, `werkelijkHuur.ts`) — een
 * standalone Werkelijk-calculator die de bestaande Begrotingsmodule niet
 * aanraakt en er niet van afhangt, en die reguliere ÉN afwijkende/
 * correctieboekingen gewoon meeneemt zoals ze in de bron staan (geen
 * maandbedrag-/contract-/begrotingsformule-aanname).
 *
 * BEWEZEN BRONMAPPING (GAT-002D-opdracht, bronproef tegen de echte
 * 023_Malcon_Beheer_BV-cache, GL04001, boekjaar 2026 periode 01–06):
 * GL04001 → MANAGEMENT/MANAGEMENTVERGOEDING, uitsluitend GL-default (OGB 4003
 * is bij deze bron aanwezig als kostplaats-/kostensoortaanduiding, maar de
 * acht bronboekingen zijn economisch homogeen — allemaal reguliere of
 * indexatiegerelateerde managementvergoeding, geen tweede businesscategorie
 * bewezen — dus GEEN kunstmatige OGB-verfijning, zie moduledoc
 * `managementCentraleMapping.ts`). Januari (€27.533,77 + €1.104,81 =
 * €28.638,58) + februari t/m juni (elk €28.638,58) = €171.831,48 — reconcilieert
 * exact met de door Seth in Informant vastgestelde H1-2026-waarde.
 *
 * TEKENSEMANTIEK — GEEN SIGN-FLIP IN DEZE CALCULATOR (zelfde principe als
 * Rente/Leegstand/Onderhoud/Huur/Beheer): `saldo` is al door de aanroeper
 * correct bepaald (debet − credit, CAL-FIN-001) en wordt hier ONGEWIJZIGD
 * gesommeerd. De bronproef-boekingen zijn ruw POSITIEF (een normale
 * debitering van een kostenrekening), consistent met de reeds bewezen
 * "kosten komen positief door"-conventie. Eventuele normalisatie naar de
 * Pure P&L Engine gebeurt uitsluitend in `managementWerkelijkPnLAdapter.ts`.
 *
 * ÉÉN CATEGORIE (zelfde precedent als Beheer/Gemeentelijke Lasten): de bron
 * kent geen bewezen sub-splitsing — de module heeft daarom exact één
 * Werkelijk-categorie, `MANAGEMENTVERGOEDING`.
 *
 * AFZONDERLIJK VAN BEHEER (GAT-002D-opdracht, expliciet): deze module en
 * `werkelijkBeheer.ts` zijn volledig onafhankelijke calculators met eigen
 * categorieën — nooit samengevoegd tot één module of één P&L-regel (zie
 * `managementWerkelijkPnLAdapter.ts` voor de gescheiden plaatsing).
 *
 * GEEN ESTIMATED IN DEZE FASE (expliciet buiten scope, GAT-002D-opdracht):
 * uitsluitend Werkelijk wordt gebouwd.
 */

export const MANAGEMENT_WERKELIJK_CATEGORIEEN = ["MANAGEMENTVERGOEDING"] as const;
export type ManagementWerkelijkCategorie = (typeof MANAGEMENT_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkManagementBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: ManagementWerkelijkCategorie | null;
  saldo: Decimal;
}

export interface WerkelijkManagementCategorieResultaat {
  categorie: ManagementWerkelijkCategorie;
  categorieTotaal: Decimal;
}

export interface WerkelijkManagementResultaat {
  /** Vaste volgorde: `MANAGEMENT_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: WerkelijkManagementCategorieResultaat[];
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
 * Management-categorie — GEEN classificatielogica hierin (zie moduledoc).
 * Reguliere én afwijkende/correctieboekingen worden identiek behandeld: elk
 * `saldo` telt gewoon mee, er is geen aparte "correctie"-tak.
 */
export function berekenWerkelijkManagement(boekingen: readonly WerkelijkManagementBoekingRegel[]): WerkelijkManagementResultaat {
  const perCategorieRegels = new Map<ManagementWerkelijkCategorie, WerkelijkManagementBoekingRegel[]>(MANAGEMENT_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkManagementBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkManagementCategorieResultaat[] = MANAGEMENT_WERKELIJK_CATEGORIEEN.map((categorie) => ({
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
