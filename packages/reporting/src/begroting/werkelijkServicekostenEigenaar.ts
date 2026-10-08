import Decimal from "decimal.js";

/**
 * Werkelijk Servicekosten Eigenaar — FASE GAT-006 (2026-09-17): de EERSTE
 * Werkelijk-laag voor de economische module SERVICEKOSTEN_EIGENAAR
 * (`PNL_ECONOMISCHE_MODULES`, `pnlBronmapping.ts`).
 *
 * WAAROM DEZE MODULE BESTAAT (GAT-006, architectuurcorrectie): de EBITDA
 * Coverage Gate (2026-09-15) en de EBITDA-CANON-fase (2026-09-16) hebben
 * vastgesteld dat GL4350 economisch te breed is om onder het hoofddomein
 * `LEEGSTAND` te vallen — diezelfde GL kan zowel REGULIERE servicekosten van
 * de eigenaar dragen als servicekosten TIJDENS LEEGSTAND (bewezen: OGB4319
 * "Servicekosten leegstand"). `LEEGSTAND` was hier eerder een te specifieke
 * SUBCATEGORIE, geen breed genoeg HOOFDDOMEIN (zie `pnlBronmapping.ts`'s
 * addendum). Er is nooit een gepersisteerde productiemapping voor GL4350
 * geweest — uitsluitend testfixtures — dus is er niets te migreren.
 *
 * TWEE CATEGORIEËN (GAT-006-opdracht, minimaal vereist onderscheid):
 * `SERVICEKOSTEN_EIGENAAR_REGULIER` en `SERVICEKOSTEN_LEEGSTAND`. GEEN
 * verzamelbak voor alle leegstand: `NUTS_LEEGSTAND`/`OVERIGE_LEEGSTANDSKOSTEN`
 * (`begroteLeegstand.ts`, hoofddomein `LEEGSTAND`) blijven ONGEWIJZIGD
 * bestaan als aparte, zelfstandige categorieën onder een ANDER hoofddomein —
 * deze module herclassificeert ze niet en neemt ze niet over.
 *
 * `SERVICEKOSTEN_LEEGSTAND` (deze module) EN `LEEGSTAND`'s eigen categorieën
 * DELEN GEEN DATA: het zijn twee VERSCHILLENDE hoofddomeinen met elk hun
 * eigen calculator/resultaattype — het feit dat de categorienaam
 * "SERVICEKOSTEN_LEEGSTAND" ook hier voorkomt is uitsluitend een
 * PRESENTATIE-overeenkomst (beide betreffen economisch "kosten tijdens
 * leegstand"), GEEN gedeeld type, GEEN dubbele telling: een boeking wordt
 * altijd via PRECIES ÉÉN (bedrijfsnr, GL) → hoofddomein geclassificeerd
 * (M4b), dus een euro landt nooit tegelijk in `LEEGSTAND` én
 * `SERVICEKOSTEN_EIGENAAR`.
 *
 * NIEUW ARCHITECTUURPATROON (M7-precedent): deze calculator kent GEEN
 * grootboekrekening/OGB/administratiecode — puur economische betekenis in
 * (`economischeCategorie`, al bepaald door de centrale resolver), economisch
 * resultaat uit. Zie `servicekostenEigenaarCentraleMapping.ts` voor de
 * bron-naar-categorie-vertaling en het bewezen 070/GL4350/OGB4319-bewijs.
 *
 * GEEN ESTIMATED IN DEZE FASE (expliciet buiten scope, GAT-006-opdracht):
 * uitsluitend Werkelijk wordt gebouwd.
 */

export const SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN = ["SERVICEKOSTEN_EIGENAAR_REGULIER", "SERVICEKOSTEN_LEEGSTAND"] as const;
export type ServicekostenEigenaarWerkelijkCategorie = (typeof SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkServicekostenEigenaarBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: ServicekostenEigenaarWerkelijkCategorie | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface WerkelijkServicekostenEigenaarComplexTotaal {
  complexnummer: string | null;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkServicekostenEigenaarCategorieResultaat {
  categorie: ServicekostenEigenaarWerkelijkCategorie;
  categorieTotaal: Decimal;
  perComplex: WerkelijkServicekostenEigenaarComplexTotaal[];
}

export interface WerkelijkServicekostenEigenaarResultaat {
  /** Vaste volgorde: `SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN`. */
  perCategorie: WerkelijkServicekostenEigenaarCategorieResultaat[];
  /** Afgeleide som van de categorieTotalen — GEEN eigen, derde boekingscategorie. */
  moduleTotaal: Decimal;
  /** Boekingen zonder geldige centrale mapping — NOOIT geraden, NOOIT meegeteld in een categorie (GL-residual, zie moduledoc GAT-006). */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function complexTotalenServicekostenEigenaar(regels: readonly WerkelijkServicekostenEigenaarBoekingRegel[]): WerkelijkServicekostenEigenaarComplexTotaal[] {
  const perComplexMap = new Map<string | null, WerkelijkServicekostenEigenaarBoekingRegel[]>();
  for (const regel of regels) {
    const groep = perComplexMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplexMap.set(regel.complexnummer, groep);
  }
  return Array.from(perComplexMap.entries())
    .map(([complexnummer, groep]) => ({ complexnummer, saldo: som(groep.map((r) => r.saldo)), aantalBoekingen: groep.length }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));
}

/**
 * Groepeert reeds economisch geclassificeerde boekingen per categorie —
 * GEEN classificatielogica hierin (zie moduledoc). `moduleTotaal` is
 * uitsluitend de som van de categorieTotalen; niet-geclassificeerde
 * bedragen blijven expliciet zichtbaar als GL-residual, nooit stil verdeeld
 * over REGULIER/LEEGSTAND.
 */
export function berekenWerkelijkServicekostenEigenaar(boekingen: readonly WerkelijkServicekostenEigenaarBoekingRegel[]): WerkelijkServicekostenEigenaarResultaat {
  const perCategorieRegels = new Map<ServicekostenEigenaarWerkelijkCategorie, WerkelijkServicekostenEigenaarBoekingRegel[]>(SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkServicekostenEigenaarBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkServicekostenEigenaarCategorieResultaat[] = SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perComplex: complexTotalenServicekostenEigenaar(regels) };
  });

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
  };
}
