import Decimal from "decimal.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie, type BgAlgemeneKostenResultaat } from "./begroteAlgemeneKosten.js";

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
 * ESTIMATED (FASE GAT-008A, 2026-09-17, `berekenEstimatedAlgemeneKosten`
 * hieronder) — zelfde bewezen OB-030/031-patroon als Rente/Leegstand/
 * Verzekeringen/Gemeentelijke Lasten, hier per categorie (alle vijf
 * bestaande, ongewijzigde `ALGEMENE_KOSTEN_CATEGORIEEN`):
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar`.
 * `begroteAlgemeneKosten.ts`'s `berekendVoorstel`-rekenhulp (vorigJaarBedrag ×
 * (1 + verwachteVerhogingPercentage)) is EEN mogelijke, geen verplichte, bron
 * voor de handmatige `verwachtingResterendJaar`-aanname per categorie — deze
 * module herberekent die rekenhulp niet zelf, om geen tweede rekenpad naast
 * `berekenBegroteAlgemeneKosten` te introduceren. `begrotingTotaal`
 * (`categorieTotaal` uit de Begroting) wordt ONGEWIJZIGD doorgegeven.
 *
 * WERKELIJK-DEKKING ALS AANVULLENDE, EXPLICIETE VOORWAARDE (GAT-001B
 * §5-invariant, zoals ook toegepast op Verzekeringen/Gemeentelijke Lasten):
 * `estimatedTotaal` is uitsluitend niet-`null` wanneer zowel Werkelijk-
 * dekking bevestigd is (`werkelijkDekkingBevestigd` én
 * `nietGeclassificeerdTotaal === 0`, MODULEBREED — één en dezelfde
 * boekingenbron voedt alle vijf categorieën tegelijk) als
 * `verwachtingResterendJaar` voor DIE categorie een geldige Decimal is. Elke
 * categorie behoudt haar EIGEN verwachting/estimatedTotaal — "Taxatie/
 * Verhuurbemiddeling" blijft uitsluitend een presentatielabel binnen
 * MAKELAARSKOSTEN, geen eigen regel (zelfde grens als
 * `algemeneKostenWerkelijkPnLAdapter.ts`).
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

// ── Estimated (FASE GAT-008A, 2026-09-17) ───────────────────────────────────

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

export interface EstimatedAlgemeneKostenCategorieResultaat {
  categorie: BgAlgemeneKostenCategorie;
  /** Ongewijzigde doorgifte van de Begroting-categorie — Estimated berekent/muteert de Begroting nooit. */
  begrotingTotaal: Decimal;
  werkelijkTotaal: Decimal;
  /** Modulebreed (zie moduledoc) — `false` zodra Werkelijk-dekking niet expliciet bevestigd is of `nietGeclassificeerdTotaal` niet nul is. */
  werkelijkVoldoendeBekend: boolean;
  /** Handmatige, expliciet aangeleverde/overridable aanname PER CATEGORIE — `null` = nog niet ingevuld. */
  verwachtingResterendJaar: Decimal | null;
  estimatedTotaal: Decimal | null;
  afwijking: Decimal | null;
}

export interface EstimatedAlgemeneKostenResultaat {
  /** Vaste volgorde: `ALGEMENE_KOSTEN_CATEGORIEEN`. */
  perCategorie: EstimatedAlgemeneKostenCategorieResultaat[];
  moduleBegrotingTotaal: Decimal;
  moduleWerkelijkTotaal: Decimal;
  /** `null` zodra één van de vijf categorieën `estimatedTotaal === null` heeft. */
  moduleEstimatedTotaal: Decimal | null;
}

/**
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar` per
 * categorie — zie moduledoc. `werkelijkDekkingBevestigd` is modulebreed (één
 * Boekingen-bron voedt alle vijf categorieën), `verwachtingPerCategorie`
 * blijft per categorie afzonderlijk instelbaar.
 */
export function berekenEstimatedAlgemeneKosten(
  begroting: BgAlgemeneKostenResultaat,
  werkelijk: WerkelijkAlgemeneKostenResultaat,
  werkelijkDekkingBevestigd: boolean,
  verwachtingPerCategorie: Record<BgAlgemeneKostenCategorie, Decimal | null>,
): EstimatedAlgemeneKostenResultaat {
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();

  const perCategorie: EstimatedAlgemeneKostenCategorieResultaat[] = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => {
    const begrotingTotaal = begroting.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const verwachting = verwachtingPerCategorie[categorie];
    const estimatedTotaal = werkelijkVoldoendeBekend && isGeldigDecimal(verwachting) ? werkelijkTotaal.plus(verwachting) : null;
    return {
      categorie,
      begrotingTotaal,
      werkelijkTotaal,
      werkelijkVoldoendeBekend,
      verwachtingResterendJaar: verwachting,
      estimatedTotaal,
      afwijking: estimatedTotaal !== null ? estimatedTotaal.minus(begrotingTotaal) : null,
    };
  });

  const moduleEstimatedTotaal = perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null;

  return {
    perCategorie,
    moduleBegrotingTotaal: begroting.moduleTotaal,
    moduleWerkelijkTotaal: werkelijk.moduleTotaal,
    moduleEstimatedTotaal,
  };
}
