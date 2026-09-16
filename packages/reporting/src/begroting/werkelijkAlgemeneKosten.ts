import Decimal from "decimal.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "./begroteAlgemeneKosten.js";

/**
 * Werkelijk Algemene Kosten — FASE GAT-009 (2026-09-16): de EERSTE
 * Werkelijk-laag voor de economische module ALGEMENE_KOSTEN
 * (`PNL_ECONOMISCHE_MODULES`, `pnlBronmapping.ts`).
 *
 * DIT IS GEEN HERBEREKENING VAN MODULE 2/BEGROTE ALGEMENE KOSTEN
 * (`begroteAlgemeneKosten.ts`): die module blijft volledig ongewijzigd en
 * berekent de BEGROTE algemene kosten uit een eigen jaarbedrag-/
 * verwachte-verhogingslogica — een fundamenteel andere bron dan de
 * boekhouding. Deze module doet daar NIETS mee: WERKELIJKE algemene kosten
 * komen uitsluitend uit Boekingen, exact hetzelfde architectuurprincipe als
 * Huur (GAT-002B)/Beheer (GAT-002C)/Management (GAT-002D) — een standalone
 * Werkelijk-calculator die de bestaande Begrotingsmodule niet aanraakt en er
 * niet van afhangt.
 *
 * BESTAANDE BUSINESSCATEGORIEËN, ONGEWIJZIGD (GAT-009-opdracht, expliciet):
 * hergebruikt rechtstreeks `ALGEMENE_KOSTEN_CATEGORIEEN`/`BgAlgemeneKostenCategorie`
 * uit `begroteAlgemeneKosten.ts` (ACCOUNTANT/ALGEMENE_KOSTEN/JURIDISCHE_KOSTEN/
 * MAKELAARSKOSTEN/BANKKOSTEN) — GEEN nieuwe, parallelle categorie-enum (in
 * tegenstelling tot Huur/Beheer/Management, die zelf geen bestaande enum
 * hadden om te hergebruiken). "Taxatie/Verhuurbemiddeling" is uitsluitend een
 * presentatielabel/economische betekenis BINNEN `MAKELAARSKOSTEN` — geen
 * eigen categorie, zie moduledoc `algemeneKostenCentraleMapping.ts`.
 *
 * BEWEZEN BRONMAPPING (bestaand M2-bewijs, `algemeneKostenCentraleMapping.test.ts`,
 * 070/GL4990, boekjaar 2025): OGB4990/4991 → ALGEMENE_KOSTEN (GL-default),
 * OGB4992 → MAKELAARSKOSTEN (GL+OGB), OGB4995 → BANKKOSTEN (GL+OGB). Totaal
 * GL4990 = €572,99 + (−€0,62) + €6.067,24 + €40,15 = €6.679,76 — herbevestigd
 * in `algemeneKostenWerkelijkKetenProof.test.ts` op de volledige, nieuwe
 * Werkelijk-productieketen.
 *
 * TEKENSEMANTIEK — GEEN SIGN-FLIP IN DEZE CALCULATOR (zelfde principe als
 * Rente/Leegstand/Onderhoud/Huur/Beheer/Management): `saldo` is al door de
 * aanroeper correct bepaald (debet − credit, CAL-FIN-001) en wordt hier
 * ONGEWIJZIGD gesommeerd. Eventuele normalisatie naar de Pure P&L Engine
 * gebeurt uitsluitend in `algemeneKostenWerkelijkPnLAdapter.ts`.
 *
 * GEEN ESTIMATED IN DEZE FASE (expliciet buiten scope, GAT-009-opdracht —
 * dat hoort bij GAT-008): uitsluitend Werkelijk wordt gebouwd.
 */

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkAlgemeneKostenBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: BgAlgemeneKostenCategorie | null;
  saldo: Decimal;
}

export interface WerkelijkAlgemeneKostenCategorieResultaat {
  categorie: BgAlgemeneKostenCategorie;
  categorieTotaal: Decimal;
}

export interface WerkelijkAlgemeneKostenResultaat {
  /** Vaste volgorde: `ALGEMENE_KOSTEN_CATEGORIEEN`. */
  perCategorie: WerkelijkAlgemeneKostenCategorieResultaat[];
  /** Som van de vijf categorieTotalen — GEEN eigen, zesde boekingscategorie. */
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/**
 * Groepeert reeds economisch geclassificeerde boekingen per bestaande
 * Algemene-Kosten-categorie — GEEN classificatielogica hierin (zie
 * moduledoc).
 */
export function berekenWerkelijkAlgemeneKosten(boekingen: readonly WerkelijkAlgemeneKostenBoekingRegel[]): WerkelijkAlgemeneKostenResultaat {
  const perCategorieRegels = new Map<BgAlgemeneKostenCategorie, WerkelijkAlgemeneKostenBoekingRegel[]>(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkAlgemeneKostenBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkAlgemeneKostenCategorieResultaat[] = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => ({
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
