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
 * ESTIMATED (FASE GAT-008B, 2026-09-17, `berekenEstimatedOnderhoud` hieronder)
 * — zelfde bewezen OB-030/031-/GAT-008A-patroon: `estimatedTotaal =
 * werkelijkTotaal + verwachtingResterendJaar`, per Werkelijk-categorie
 * (`ONDERHOUD_WERKELIJK_CATEGORIEEN` — Gebouwen/Terrein/Installaties, DEZELFDE
 * dimensie als Werkelijk, GEEN nieuwe "Gepland versus Correctief"-P&L-
 * hoofdindeling, zie `onderhoudEstimatedPnLAdapter.ts`).
 *
 * BEWUST GEEN `begrotingTotaal`-VELD OP DIT RESULTAAT (kernontwerpbeslissing,
 * GAT-008B): anders dan Verzekeringen/Gemeentelijke Lasten/Algemene Kosten
 * (waar Begroting en Werkelijk dezelfde, of een reconcilieerbare, dimensie
 * delen) heeft Onderhoud TWEE gescheiden Begrotingsmodellen
 * (`begroteGeplandOnderhoud.ts`/`begroteCorrectiefDagelijksOnderhoud.ts`,
 * gepland/correctief) die BEIDE een fundamenteel ANDERE dimensie gebruiken
 * dan Werkelijk (asset-/objecttype) — er bestaat geen bewezen, betrouwbare
 * verdeelsleutel om een Gepland/Correctief-jaarbedrag over Gebouwen/Terrein/
 * Installaties te verdelen (dat zou precies de "kunstmatige koppeling" zijn
 * die de GAT-008B-opdracht expliciet verbiedt). Deze functie ontvangt daarom
 * BEWUST GEEN Begroting-resultaat als parameter — structureel onmogelijk om
 * Begroting per ongeluk mee te tellen, in plaats van een gedisciplineerde
 * "wel ontvangen, maar nooit gebruiken"-belofte. `begroteGeplandOnderhoud.ts`/
 * `begroteCorrectiefDagelijksOnderhoud.ts` blijven zelf volledig ONGEWIJZIGD
 * en herbruikbaar: de gebruiker mag bestaande activiteiten bijstellen,
 * kwartalen aanpassen, status naar UITGESTELD/VERVALLEN/AFGEROND zetten, of
 * nieuwe ONVOORZIEN-activiteiten toevoegen (allemaal al bestaande,
 * ongewijzigde mogelijkheden van `BgGeplandOnderhoudActiviteitInvoer`/
 * `BgGeplandOnderhoudStatus`) om zelf tot een `verwachtingResterendJaar`-
 * getal te komen — die afleiding is en blijft een MENSELIJKE/aanroepende-
 * laag-beslissing, nooit een automatische boeking-naar-activiteit-koppeling
 * in deze module.
 *
 * WERKELIJKE BOEKINGEN WORDEN NOOIT AAN INDIVIDUELE GEPLANDE/CORRECTIEVE
 * REGELS GEKOPPELD (GAT-008B-opdracht, expliciet — "daarvoor bestaat geen
 * betrouwbare bronkoppeling"): `WerkelijkOnderhoudBoekingRegel` kent, exact
 * zoals hierboven al gold voor Werkelijk, geen enkel veld dat naar een
 * Gepland-/Correctief-activiteit/-regel verwijst.
 *
 * WERKELIJK-DEKKING ALS AANVULLENDE, EXPLICIETE VOORWAARDE (GAT-001B
 * §5-invariant, zelfde toepassing als GAT-008A): `estimatedTotaal` is per
 * categorie uitsluitend niet-`null` wanneer zowel Werkelijk-dekking bevestigd
 * is (`werkelijkDekkingBevestigd`, modulebreed — één Boekingen-bron voedt
 * alle drie categorieën, én `nietGeclassificeerdTotaal === 0`) als
 * `verwachtingResterendJaar` voor DIE categorie een geldige Decimal is.
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

// ── Estimated (FASE GAT-008B, 2026-09-17) ───────────────────────────────────

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

export interface EstimatedOnderhoudCategorieResultaat {
  categorie: OnderhoudWerkelijkCategorie;
  werkelijkTotaal: Decimal;
  /** `false` zodra Werkelijk-dekking niet expliciet bevestigd is of `nietGeclassificeerdTotaal` niet nul is — zie moduledoc. */
  werkelijkVoldoendeBekend: boolean;
  /** Handmatige, expliciet aangeleverde/overridable aanname PER CATEGORIE — `null` = nog niet ingevuld. GEEN historisch gemiddelde, GEEN lineaire extrapolatie, GEEN kunstmatige verdeling van Gepland/Correctief-bedragen over deze categorie (zie moduledoc). */
  verwachtingResterendJaar: Decimal | null;
  /** `werkelijkTotaal + verwachtingResterendJaar`, uitsluitend wanneer zowel Werkelijk-dekking als de verwachting bekend zijn. */
  estimatedTotaal: Decimal | null;
}

export interface EstimatedOnderhoudResultaat {
  /** Vaste volgorde: `ONDERHOUD_WERKELIJK_CATEGORIEEN`. */
  perCategorie: EstimatedOnderhoudCategorieResultaat[];
  moduleWerkelijkTotaal: Decimal;
  /** `null` zodra één van de drie categorieën `estimatedTotaal === null` heeft. */
  moduleEstimatedTotaal: Decimal | null;
}

/**
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar` per
 * Werkelijk-categorie — zie moduledoc voor waarom hier bewust GEEN
 * Begroting-parameter bestaat (Gepland/Correctief kennen een andere
 * dimensie, geen bewezen verdeelsleutel naar Gebouwen/Terrein/Installaties).
 */
export function berekenEstimatedOnderhoud(
  werkelijk: WerkelijkOnderhoudResultaat,
  werkelijkDekkingBevestigd: boolean,
  verwachtingPerCategorie: Record<OnderhoudWerkelijkCategorie, Decimal | null>,
): EstimatedOnderhoudResultaat {
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();

  const perCategorie: EstimatedOnderhoudCategorieResultaat[] = ONDERHOUD_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const verwachting = verwachtingPerCategorie[categorie];
    const estimatedTotaal = werkelijkVoldoendeBekend && isGeldigDecimal(verwachting) ? werkelijkTotaal.plus(verwachting) : null;
    return { categorie, werkelijkTotaal, werkelijkVoldoendeBekend, verwachtingResterendJaar: verwachting, estimatedTotaal };
  });

  const moduleEstimatedTotaal = perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null;

  return { perCategorie, moduleWerkelijkTotaal: werkelijk.moduleTotaal, moduleEstimatedTotaal };
}
