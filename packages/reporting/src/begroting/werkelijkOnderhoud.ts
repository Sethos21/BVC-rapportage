import Decimal from "decimal.js";

/**
 * Werkelijk Onderhoud — FASE M7 (2026-09-15): de EERSTE Werkelijk-laag voor
 * de economische module ONDERHOUD (`PNL_ECONOMISCHE_MODULES`, `pnlBronmapping.ts`).
 *
 * DIT IS GEEN "WerkelijkGeplandOnderhoud" EN GEEN "WerkelijkCorrectiefOnderhoud"
 * (M7-opdracht §1/§5): de bestaande Begrotingsmodules `begroteGeplandOnderhoud.ts`
 * (GO) en `begroteCorrectiefDagelijksOnderhoud.ts` (CD) splitsen onderhoud op
 * basis van een EXPLICIETE GEBRUIKERSCLASSIFICATIE (gepland vs. correctief/
 * dagelijks) die de boekhouding niet kan reproduceren — GO se eigen moduledoc
 * is daar expliciet over: "gepland versus correctief/dagelijks is een
 * expliciete gebruikersclassificatie, nooit uit de boekhouding afgeleid".
 * Voor WERKELIJKE boekingen is de enige BETROUWBARE bronuitsplitsing het
 * asset-/objecttype waarop geboekt is (bewezen: GL4300/GL4330/GL4340) — dat
 * is een ANDERE dimensie dan gepland/correctief, en de twee mogen NOOIT aan
 * elkaar gekoppeld worden zonder dat de bron dat bewijst (wat hij niet doet).
 * Deze module is daarom bewust een DERDE, standalone Werkelijk-calculator
 * voor de ONDERHOUD-economische-module als geheel — GEEN aanpassing aan, en
 * GEEN koppeling met, de twee bestaande Begrotingsmodules.
 *
 * BEWEZEN BRONUITSPLITSING (M7-opdracht §5): GL4300 → Onderhoud gebouwen,
 * GL4330 → Onderhoud terrein, GL4340 → Onderhoud installaties — alle drie
 * uitsluitend op GL-niveau bewezen (geen OGB-verfijning aangeleverd). Zie
 * `onderhoudCentraleMapping.ts` voor de bron-naar-categorie-vertaling.
 *
 * NIEUW ARCHITECTUURPATROON (M7-opdracht §0, zelfde als Verzekeringen/
 * Gemeentelijke Lasten hierboven): deze calculator kent GEEN grootboek-
 * rekening/OGB, GEEN vrije tekst, GEEN bedrag-gebaseerde heuristiek — puur
 * economische betekenis in (`economischeCategorie`, al bepaald door de
 * centrale resolver), economisch resultaat uit. Geen automatische
 * gepland/correctief-afleiding is dan ook stucturally onmogelijk: die
 * dimensie bestaat in dit type helemaal niet.
 *
 * GEEN VIERDE, DUBBEL GETELDE CATEGORIE (M7-opdracht §11): `moduleTotaal` is
 * uitsluitend de afgeleide som van de drie categorieTotalen — nooit een
 * eigen, apart bijgehouden "algemeen onderhoud"-boekingscategorie.
 *
 * GEEN ESTIMATED IN DEZE FASE (M7-opdracht §8): "geen automatische
 * extrapolatie van incidenteel/groot onderhoud" — er bestaat geen bestaande,
 * eenduidige Estimated-formule voor onderhoud om op voort te bouwen (GO/CD
 * kennen zelf ook geen Estimated). Uitsluitend Werkelijk wordt gebouwd;
 * Estimated blijft een expliciet BRONGAT (zie de M7-rapportage).
 */

export const ONDERHOUD_WERKELIJK_CATEGORIEEN = ["ONDERHOUD_GEBOUWEN", "ONDERHOUD_TERREIN", "ONDERHOUD_INSTALLATIES"] as const;
export type OnderhoudWerkelijkCategorie = (typeof ONDERHOUD_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkOnderhoudBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: OnderhoudWerkelijkCategorie | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface WerkelijkOnderhoudComplexTotaal {
  complexnummer: string | null;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkOnderhoudCategorieResultaat {
  categorie: OnderhoudWerkelijkCategorie;
  categorieTotaal: Decimal;
  perComplex: WerkelijkOnderhoudComplexTotaal[];
}

export interface WerkelijkOnderhoudResultaat {
  /** Vaste volgorde: `ONDERHOUD_WERKELIJK_CATEGORIEEN`. */
  perCategorie: WerkelijkOnderhoudCategorieResultaat[];
  /** Afgeleide som van de drie categorieTotalen — GEEN eigen, vierde boekingscategorie (zie moduledoc). */
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function complexTotalenOnderhoud(regels: readonly WerkelijkOnderhoudBoekingRegel[]): WerkelijkOnderhoudComplexTotaal[] {
  const perComplexMap = new Map<string | null, WerkelijkOnderhoudBoekingRegel[]>();
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
 * Groepeert reeds economisch geclassificeerde boekingen per asset-/
 * objecttype-categorie — GEEN classificatielogica hierin, GEEN gepland-
 * versus-correctief-afleiding (zie moduledoc: die dimensie bestaat hier
 * niet).
 */
export function berekenWerkelijkOnderhoud(boekingen: readonly WerkelijkOnderhoudBoekingRegel[]): WerkelijkOnderhoudResultaat {
  const perCategorieRegels = new Map<OnderhoudWerkelijkCategorie, WerkelijkOnderhoudBoekingRegel[]>(ONDERHOUD_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkOnderhoudBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkOnderhoudCategorieResultaat[] = ONDERHOUD_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perComplex: complexTotalenOnderhoud(regels) };
  });

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
  };
}
